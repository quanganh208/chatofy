/**
 * Per-speaker ordered TTS audio sink for the mobile conference — the React
 * Native parallel of web's `TranslationAudioSink`
 * (apps/web/src/hooks/use-translation-audio-sink.ts).
 *
 * The resequencing policy is ported verbatim: one logical sink per
 * `speakerSocketId`, frames buffered by `sequence`, drained in-order so no two
 * frames overlap and none play before an earlier sequence arrives. Gapless
 * scheduling is REUSED from `@chatofy/realtime-client`'s `PcmPlaybackQueue`,
 * which depends only on the standard Web Audio API (`createBuffer`,
 * `createBufferSource`, `currentTime`, `start`/`stop`/`onended`) that
 * react-native-audio-api implements. The only RN-specific change from the web
 * sink is the `AudioContext` source (react-native-audio-api instead of the DOM)
 * and base64 decoding via `base64ToPcm16` instead of the browser `atob` loop.
 */

import { AudioContext } from 'react-native-audio-api';
import { PcmPlaybackQueue, base64ToPcm16 } from '@chatofy/realtime-client';

// react-native-audio-api's AudioContext implements the Web Audio surface
// PcmPlaybackQueue needs, but its TypeScript types are its own. Cast at the
// single seam here so the queue's standard-Web-Audio typing is satisfied.
type WebAudioContext = ConstructorParameters<typeof PcmPlaybackQueue>[0];

interface PendingFrame {
  sequence: number;
  samples: Int16Array;
  sampleRate: number;
}

interface SpeakerSink {
  ctx: AudioContext;
  queue: PcmPlaybackQueue;
  /** Frames waiting for an earlier sequence to arrive first. */
  buffer: PendingFrame[];
  /** Next expected sequence number; starts at 0 per speaker. */
  nextSeq: number;
}

/**
 * Stateful ordered audio sink for all remote TTS frames in a conference room.
 *
 * Lifecycle: create once per call; `push()` each incoming audio frame; `close()`
 * on leave to release all AudioContexts.
 */
export class NativeTranslationAudioSink {
  private readonly speakers = new Map<string, SpeakerSink>();

  /**
   * Decode and schedule a base64 PCM16-LE TTS frame for ordered playback.
   *
   * @param speakerSocketId - Identifies which speaker's stream this frame belongs to.
   * @param sequence        - 0-based frame sequence number within this speaker's stream.
   * @param sampleRate      - PCM sample rate of this frame (TTS, typically 22050 or 24000).
   * @param payloadB64      - Base64-encoded little-endian PCM16 samples.
   */
  push(speakerSocketId: string, sequence: number, sampleRate: number, payloadB64: string): void {
    const sink = this.getOrCreate(speakerSocketId, sampleRate);

    let pcm: Int16Array;
    try {
      pcm = base64ToPcm16(payloadB64);
    } catch (err) {
      // A malformed payload is a single dropped frame, not a reason to tear the
      // whole speaker's stream down — the resequencer treats it as a gap.
      console.warn(`[audio] dropping malformed frame seq=${sequence} from ${speakerSocketId}`, err);
      return;
    }

    sink.buffer.push({ sequence, samples: pcm, sampleRate });
    this.drainSink(speakerSocketId, sink);
  }

  /**
   * Release all AudioContexts and discard all queued audio. Must be called when
   * the local participant leaves the room.
   */
  close(): void {
    for (const sink of this.speakers.values()) {
      sink.queue.stop();
      void sink.ctx.close();
    }
    this.speakers.clear();
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private getOrCreate(speakerSocketId: string, sampleRate: number): SpeakerSink {
    const existing = this.speakers.get(speakerSocketId);
    if (existing) return existing;

    // One context per speaker, pinned to that speaker's TTS sample rate so the
    // samples play at their native pitch. Unlike web there is no autoplay policy
    // to defer the context, so no suspended-resume dance is needed on RN.
    const ctx = new AudioContext({ sampleRate });
    const queue = new PcmPlaybackQueue(ctx as unknown as WebAudioContext);
    const sink: SpeakerSink = { ctx, queue, buffer: [], nextSeq: 0 };
    this.speakers.set(speakerSocketId, sink);
    return sink;
  }

  /**
   * Drain the contiguous prefix of buffered frames starting at `sink.nextSeq`.
   *
   * Frames that arrive before their predecessor are held. Duplicate or
   * already-played frames (sequence < nextSeq) are dropped. A gap — a missing
   * frame that never arrives — holds the buffer; `PcmPlaybackQueue` restarts its
   * schedule clock when the queue runs dry, so a later flush still plays after
   * dead air. (Ported from web `TranslationAudioSink.drainSink`.)
   */
  private drainSink(speakerSocketId: string, sink: SpeakerSink): void {
    sink.buffer.sort((a, b) => a.sequence - b.sequence);

    while (sink.buffer.length > 0) {
      const frame = sink.buffer[0];
      if (frame === undefined) break;

      if (frame.sequence < sink.nextSeq) {
        // Duplicate frame already played — discard.
        sink.buffer.shift();
        continue;
      }

      if (frame.sequence > sink.nextSeq) {
        // Gap: hold until the missing sequence arrives.
        break;
      }

      // frame.sequence === sink.nextSeq: ready to play. The speakerSocketId is
      // the turnKey so all of one speaker's frames share a single timeline and
      // play gaplessly end-to-end.
      sink.buffer.shift();
      sink.queue.enqueue(speakerSocketId, frame.samples, frame.sampleRate);
      sink.nextSeq++;
    }
  }
}
