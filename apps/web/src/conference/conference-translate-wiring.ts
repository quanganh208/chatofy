/**
 * The speaker's translate leg: microphone → `/ws/translate` (live mode) → the room.
 *
 * Opens one live session for the local microphone, streams pcm16 frames to it,
 * and relays what comes back into `/ws/conference` as
 * `conference.translation.broadcast` — subtitles grouped into turns by
 * `SubtitleTurnAccumulator`, translated speech frame by frame.
 *
 * Returns a handle whose `stop()` ends the session, closes the socket and
 * releases the capture graph. The caller MUST call it on leave, on teardown
 * before a reconnect, and on unmount: nothing else closes this socket, and a
 * forgotten one keeps streaming the microphone to speech recognition.
 */
import { liveServerEventSchema, WS_SUBPROTOCOL } from '@chatofy/types/events';
import type { LanguageCode } from '@chatofy/types';
import { conferenceDebug } from './conference-debug-log';
import { send } from './conference-signaling';
import { SubtitleTurnAccumulator } from './subtitle-turn-accumulator';

const CAPTURE_SAMPLE_RATE = 16_000;
const CAPTURE_BUFFER_FRAMES = 4096;

export interface TranslateHandle {
  stop(): void;
}

export interface WireTranslateOptions {
  translateUrl: string;
  conferenceSocket: WebSocket;
  stream: MediaStream;
  sourceLanguage: LanguageCode;
  token: string;
  /** True while the speaker's current turn is open, false once it closes. */
  onTranslating: (active: boolean) => void;
}

/** The other language of the vi↔en pair. */
export function targetLanguageFor(source: LanguageCode): LanguageCode {
  return source === 'en' ? 'vi' : 'en';
}

function toBase64Pcm16(samples: Float32Array): string {
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, (samples[i] ?? 0) * 32768));
  }
  return btoa(String.fromCharCode(...new Uint8Array(int16.buffer)));
}

export function wireTranslate(options: WireTranslateOptions): TranslateHandle {
  const { conferenceSocket, sourceLanguage, onTranslating } = options;
  const targetLanguage = targetLanguageFor(sourceLanguage);
  const captureSessionId = crypto.randomUUID();
  let stopped = false;

  const turns = new SubtitleTurnAccumulator({
    onFrame: (frame) =>
      send(conferenceSocket, 'conference.translation.broadcast', {
        subtitle: { ...frame, sourceLanguage, targetLanguage },
      }),
    onTurnOpenChange: onTranslating,
  });

  const translateWs = new WebSocket(`${options.translateUrl}/ws/translate`, [
    WS_SUBPROTOCOL,
    options.token,
  ]);

  // Capture: microphone → ScriptProcessor → pcm16 frames. The processor has to
  // reach the destination to run, so it does through a muted gain.
  const audioCtx = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE });
  const source = audioCtx.createMediaStreamSource(options.stream);
  const processor = audioCtx.createScriptProcessor(CAPTURE_BUFFER_FRAMES, 1, 1);
  const silence = audioCtx.createGain();
  silence.gain.value = 0;
  let sequence = 0;
  processor.onaudioprocess = (evt) => {
    if (translateWs.readyState !== WebSocket.OPEN) return;
    translateWs.send(
      JSON.stringify({
        event: 'client.live.audio',
        data: {
          type: 'client.live.audio',
          frame: {
            sessionId: captureSessionId,
            encoding: 'pcm16',
            sampleRate: CAPTURE_SAMPLE_RATE,
            sequence: sequence++,
            timestamp: Date.now(),
            payload: toBase64Pcm16(evt.inputBuffer.getChannelData(0)),
          },
        },
      }),
    );
  };
  source.connect(processor);
  processor.connect(silence);
  silence.connect(audioCtx.destination);

  /** Release everything. Idempotent: the socket's own close lands here too. */
  function release(): void {
    if (stopped) return;
    stopped = true;
    // Close the open turn so the room gets its final frame and the line is kept.
    turns.close();
    onTranslating(false);
    processor.onaudioprocess = null;
    source.disconnect();
    processor.disconnect();
    silence.disconnect();
    void audioCtx.close().catch(() => undefined);
  }

  translateWs.addEventListener('open', () => {
    conferenceDebug('translate socket open');
    translateWs.send(
      JSON.stringify({
        event: 'client.live.start',
        data: {
          type: 'client.live.start',
          languagePair: { source: sourceLanguage, target: targetLanguage },
        },
      }),
    );
  });

  translateWs.addEventListener('message', (evt: MessageEvent) => {
    if (typeof evt.data !== 'string') return;
    let raw: unknown;
    try {
      raw = JSON.parse(evt.data);
    } catch {
      return;
    }
    const parsed = liveServerEventSchema.safeParse(raw);
    if (!parsed.success) {
      conferenceDebug('translate: unexpected event shape');
      return;
    }
    const event = parsed.data;
    switch (event.type) {
      case 'server.live.transcript':
        turns.push(event.channel, event.delta);
        break;
      case 'server.live.audio':
        send(conferenceSocket, 'conference.translation.broadcast', {
          audio: {
            lang: targetLanguage,
            sequence: event.frame.sequence,
            sampleRate: event.frame.sampleRate,
            payload: event.frame.payload,
          },
        });
        break;
      case 'server.live.ended':
      case 'server.live.error':
        conferenceDebug(`translate session over: ${event.type}`);
        turns.close();
        break;
      default:
        break;
    }
  });

  translateWs.addEventListener('close', () => {
    conferenceDebug('translate socket closed');
    release();
  });
  translateWs.addEventListener('error', () => conferenceDebug('translate socket error'));

  return {
    stop() {
      const wasStopped = stopped;
      release();
      if (wasStopped) return;
      if (translateWs.readyState === WebSocket.OPEN) {
        translateWs.send(
          JSON.stringify({ event: 'client.live.stop', data: { type: 'client.live.stop' } }),
        );
      }
      if (
        translateWs.readyState === WebSocket.OPEN ||
        translateWs.readyState === WebSocket.CONNECTING
      ) {
        translateWs.close(1000, 'stopped');
      }
    },
  };
}
