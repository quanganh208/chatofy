/**
 * Whether any other peer is audibly talking, read from their received audio.
 *
 * The conference leg's guard against a loop when echo cancellation is off: a
 * peer's voice coming out of this device's loudspeaker would otherwise reach the
 * microphone and open a turn translated as ours. While this reports sound, the
 * capture pump opens no NEW turn; one already open is never cut.
 *
 * Read on demand when the pump asks, with no timers of its own, so a meeting
 * with the gate off pays nothing and one with it on pays one analyser read per
 * peer per pump frame.
 */

/** RMS above which received audio counts as speech. A first, conservative value: measure it on real calls before tuning. */
export const REMOTE_SPEECH_RMS = 0.02;

/** How long after the last loud frame the room still counts as talking, so gaps between words do not reopen the microphone. */
export const REMOTE_SPEECH_HOLD_MS = 300;

const FFT_SIZE = 1024;

export interface RemoteAudioActivityDeps {
  createContext: () => AudioContext;
  now: () => number;
  /** Told when the context is suspended or resumed, so the page can offer or drop its sound tap. */
  onStateChange?: () => void;
}

export interface RemoteAudioActivity {
  add(socketId: string, track: MediaStreamTrack): void;
  remove(socketId: string): void;
  isSounding(): boolean;
  /** True while the context is suspended, which reads silence: the page should offer its sound tap. */
  isSuspended(): boolean;
  /** Resume a suspended context. Call from a user-gesture handler. */
  resume(): Promise<void>;
  dispose(): void;
}

interface PeerTap {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
}

export function createRemoteAudioActivity(
  overrides: Partial<RemoteAudioActivityDeps> = {},
): RemoteAudioActivity {
  const deps: RemoteAudioActivityDeps = {
    createContext: () => new AudioContext(),
    now: () => performance.now(),
    ...overrides,
  };
  let context: AudioContext | null = null;
  const taps = new Map<string, PeerTap>();
  const samples = new Float32Array(FFT_SIZE);
  let lastLoudAt = Number.NEGATIVE_INFINITY;

  const disconnect = (tap: PeerTap) => {
    tap.source.disconnect();
    tap.analyser.disconnect();
  };

  return {
    add(socketId, track) {
      // Created outside a user gesture, so it may start suspended — and a
      // suspended analyser reads silence, which would leave the gate open
      // without a sound. Resumed on every add, which is cheap once running.
      if (!context) {
        context = deps.createContext();
        if (deps.onStateChange) context.onstatechange = deps.onStateChange;
      }
      void context.resume().catch(() => undefined);
      const existing = taps.get(socketId);
      if (existing) disconnect(existing);
      const source = context.createMediaStreamSource(new MediaStream([track]));
      const analyser = context.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      // Into the analyser only, never to the speakers: the peer's tile already
      // plays this audio, and a second path would double it.
      source.connect(analyser);
      taps.set(socketId, { source, analyser });
    },
    remove(socketId) {
      const tap = taps.get(socketId);
      if (!tap) return;
      disconnect(tap);
      taps.delete(socketId);
    },
    isSounding() {
      for (const { analyser } of taps.values()) {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        if (Math.sqrt(sum / samples.length) >= REMOTE_SPEECH_RMS) {
          lastLoudAt = deps.now();
          break;
        }
      }
      return deps.now() - lastLoudAt < REMOTE_SPEECH_HOLD_MS;
    },
    isSuspended() {
      return context?.state === 'suspended';
    },
    async resume() {
      if (context?.state === 'suspended') await context.resume();
    },
    dispose() {
      for (const tap of taps.values()) disconnect(tap);
      taps.clear();
      void context?.close();
      context = null;
    },
  };
}
