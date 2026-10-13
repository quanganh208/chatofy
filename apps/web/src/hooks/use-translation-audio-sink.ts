'use client';

/**
 * Per-speaker ordered TTS audio sink for conference translation.
 *
 * Replaces the per-frame `new AudioContext()` in the Phase 1 hook with one
 * `AudioContext` per speaker, keyed by `speakerSocketId`. Frames are buffered
 * by `sequence` and drained in-order so no two frames overlap and none play
 * before an earlier sequence arrives.
 *
 * Design: `PcmPlaybackQueue` from `@chatofy/realtime-client` is reused for
 * gapless Web Audio scheduling (one queue per speaker). A thin resequencing
 * buffer handles out-of-order delivery. `OrderedPlayback` from the same package
 * was NOT used because it needs an explicit turn-open / finish lifecycle driven
 * by a live-session socket; here the speakerSocketId IS the entire turn for the
 * call duration, making a plain resequence buffer the right fit.
 *
 * [T4] latency marker (inherited from the PoC) is logged on each enqueue.
 */

import { PcmPlaybackQueue } from '@chatofy/realtime-client';

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── TranslationAudioSink ─────────────────────────────────────────────────────

/**
 * Stateful ordered audio sink for all remote TTS frames in a conference room.
 *
 * Lifecycle: create once per call; `push()` each incoming audio frame;
 * `close()` on leave to release all AudioContexts.
 */
export class TranslationAudioSink {
  private readonly speakers = new Map<string, SpeakerSink>();

  /**
   * Decode and schedule a base64 PCM16-LE TTS frame for ordered playback.
   *
   * @param speakerSocketId - Identifies which speaker's stream this frame belongs to.
   * @param sequence        - 0-based frame sequence number within this speaker's stream.
   * @param sampleRate      - PCM sample rate (typically 22050 or 24000).
   * @param payloadB64      - Base64-encoded little-endian PCM16 samples.
   */
  push(speakerSocketId: string, sequence: number, sampleRate: number, payloadB64: string): void {
    const sink = this.getOrCreate(speakerSocketId, sampleRate);

    // Decode base64 PCM16-LE → Int16Array.
    const binary = atob(payloadB64);
    const pcm = new Int16Array(binary.length / 2);
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
    }

    sink.buffer.push({ sequence, samples: pcm, sampleRate });
    this.drainSink(speakerSocketId, sink);
  }

  /**
   * Release all AudioContexts and discard all queued audio.
   * Must be called when the local participant leaves the room.
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

    const ctx = new AudioContext({ sampleRate });
    const queue = new PcmPlaybackQueue(ctx);
    const sink: SpeakerSink = { ctx, queue, buffer: [], nextSeq: 0 };
    this.speakers.set(speakerSocketId, sink);
    return sink;
  }

  /**
   * Drain the contiguous prefix of buffered frames starting at `sink.nextSeq`.
   *
   * Frames that arrive before their predecessor are held in the buffer. Duplicate
   * or already-played frames (sequence < nextSeq) are dropped. Gaps — a missing
   * frame that never arrives — are resolved naturally: `PcmPlaybackQueue` restarts
   * its schedule clock when the queue runs dry, so a later flush still plays
   * correctly after dead air.
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

      // frame.sequence === sink.nextSeq: ready to play.
      sink.buffer.shift();
      // turnKey is the speakerSocketId so all frames for one speaker share a
      // single Web Audio timeline and play gaplessly end-to-end.
      sink.queue.enqueue(speakerSocketId, frame.samples, frame.sampleRate);
      console.log(
        `[T4] audio queued seq=${frame.sequence} samples=${frame.samples.length} t=${performance.now().toFixed(1)}ms`,
      );
      sink.nextSeq++;
    }
  }
}
