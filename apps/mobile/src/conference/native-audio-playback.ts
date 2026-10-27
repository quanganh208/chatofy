/**
 * Per-speaker ordered TTS audio sink for the mobile conference — the React
 * Native parallel of web's `TranslationAudioSink`
 * (apps/web/src/hooks/use-translation-audio-sink.ts).
 *
 * Ordering lives in the pure `TranslationAudioResequencer`: one cursor per
 * `speakerSocketId`, starting at the first sequence seen, skipping a gap that
 * stays open too long. Gapless scheduling is REUSED from
 * `@chatofy/realtime-client`'s `PcmPlaybackQueue`, which depends only on the
 * standard Web Audio API (`createBuffer`, `createBufferSource`, `currentTime`,
 * `start`/`stop`/`onended`) that react-native-audio-api implements. The
 * RN-specific parts are the `AudioContext` source (react-native-audio-api) and
 * base64 decoding via `base64ToPcm16`.
 */

import { AudioContext } from 'react-native-audio-api';
import { PcmPlaybackQueue, base64ToPcm16 } from '@chatofy/realtime-client';
import { TranslationAudioResequencer } from './translation-audio-resequencer';

// react-native-audio-api's AudioContext implements the Web Audio surface
// PcmPlaybackQueue needs, but its TypeScript types are its own. Cast at the
// single seam here so the queue's standard-Web-Audio typing is satisfied.
type WebAudioContext = ConstructorParameters<typeof PcmPlaybackQueue>[0];

interface DecodedFrame {
  samples: Int16Array;
  sampleRate: number;
}

interface SpeakerOutput {
  ctx: AudioContext;
  queue: PcmPlaybackQueue;
}

/**
 * Stateful ordered audio sink for all remote TTS frames in a conference room.
 *
 * Lifecycle: create once per call; `push()` each incoming audio frame;
 * `removeSpeaker()` when a peer leaves; `close()` on leave to release all
 * AudioContexts.
 */
export class NativeTranslationAudioSink {
  private readonly outputs = new Map<string, SpeakerOutput>();
  private readonly resequencer = new TranslationAudioResequencer<DecodedFrame>({
    play: (speakerSocketId, frame) => {
      const output = this.getOrCreateOutput(speakerSocketId, frame.sampleRate);
      // The speakerSocketId is the turnKey so all of one speaker's frames share
      // a single timeline and play gaplessly end-to-end.
      output.queue.enqueue(speakerSocketId, frame.samples, frame.sampleRate);
    },
  });

  /**
   * Decode and schedule a base64 PCM16-LE TTS frame for ordered playback.
   *
   * @param speakerSocketId - Identifies which speaker's stream this frame belongs to.
   * @param sequence        - The speaker's leg frame counter for this listener's language.
   * @param sampleRate      - PCM sample rate of this frame (TTS, typically 24000).
   * @param payloadB64      - Base64-encoded little-endian PCM16 samples.
   */
  push(speakerSocketId: string, sequence: number, sampleRate: number, payloadB64: string): void {
    let samples: Int16Array;
    try {
      samples = base64ToPcm16(payloadB64);
    } catch (err) {
      // A malformed payload is a single dropped frame; the resequencer skips the
      // gap it leaves after a short wait.
      console.warn(`[audio] dropping malformed frame seq=${sequence} from ${speakerSocketId}`, err);
      return;
    }
    this.resequencer.push(speakerSocketId, sequence, { samples, sampleRate });
  }

  /**
   * Whether any peer's translation is sounding on this device right now.
   *
   * The speaker leg's microphone hears this playback through the loudspeaker,
   * and at a loud volume the echo canceller lets it through; this is what keeps
   * that playback from opening a turn of its own.
   *
   * Only a running context counts: a suspended one (a phone call or Siri took
   * the audio, or `resume()` failed) never ends its queued sounds, and counting
   * them would hold the gate shut on the user's speech for the rest of the call.
   */
  isAnySounding(): boolean {
    for (const output of this.outputs.values()) {
      if (output.ctx.state === 'running' && output.queue.isPlaying) return true;
    }
    return false;
  }

  /** Stop and release one speaker's playback (they left the room). */
  removeSpeaker(speakerSocketId: string): void {
    this.resequencer.removeSpeaker(speakerSocketId);
    const output = this.outputs.get(speakerSocketId);
    if (!output) return;
    output.queue.stop();
    void output.ctx.close();
    this.outputs.delete(speakerSocketId);
  }

  /**
   * Release all AudioContexts and discard all queued audio. Must be called when
   * the local participant leaves the room.
   */
  close(): void {
    this.resequencer.clear();
    for (const output of this.outputs.values()) {
      output.queue.stop();
      void output.ctx.close();
    }
    this.outputs.clear();
  }

  private getOrCreateOutput(speakerSocketId: string, sampleRate: number): SpeakerOutput {
    const existing = this.outputs.get(speakerSocketId);
    if (existing) return existing;

    // One context per speaker, pinned to that speaker's TTS sample rate so the
    // samples play at their native pitch. react-native-audio-api creates the
    // context suspended, so it must be resumed explicitly before any scheduled
    // buffer will play — without this the AAudio player never starts.
    const ctx = new AudioContext({ sampleRate });
    void ctx.resume();
    const queue = new PcmPlaybackQueue(ctx as unknown as WebAudioContext);
    const output: SpeakerOutput = { ctx, queue };
    this.outputs.set(speakerSocketId, output);
    return output;
  }
}
