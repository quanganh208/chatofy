'use client';

/**
 * Per-speaker ordered TTS audio sink for conference translation.
 *
 * One `AudioContext` per speaker, keyed by `speakerSocketId`. Frames go through
 * a `FrameResequencer`, so they play in sequence order, start from whatever
 * sequence the speaker's session is at when this listener first hears it, and
 * skip a frame that never arrives instead of waiting on it forever.
 *
 * `PcmPlaybackQueue` from `@chatofy/realtime-client` does the gapless Web Audio
 * scheduling. `OrderedPlayback` from the same package is not used: it needs an
 * explicit turn-open / finish lifecycle driven by a live-session socket, while
 * here one speaker's stream is a single timeline for the whole call.
 */

import { PcmPlaybackQueue } from '@chatofy/realtime-client';
import { FrameResequencer } from '@/conference/frame-resequencer';

interface PcmFrame {
  samples: Int16Array;
  sampleRate: number;
}

interface SpeakerSink {
  ctx: AudioContext;
  queue: PcmPlaybackQueue;
  resequencer: FrameResequencer<PcmFrame>;
}

/** Base64 little-endian PCM16 → samples. */
function decodePcm16(payloadB64: string): Int16Array {
  const binary = atob(payloadB64);
  const pcm = new Int16Array(binary.length >> 1);
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
  }
  return pcm;
}

/**
 * Stateful ordered audio sink for all remote TTS frames in a conference room.
 *
 * Lifecycle: create once per call attempt; `push()` each incoming frame;
 * `forget()` a speaker who leaves; `close()` on leave to release every context.
 */
export class TranslationAudioSink {
  private readonly speakers = new Map<string, SpeakerSink>();

  /**
   * Decode and schedule a base64 PCM16-LE TTS frame for ordered playback.
   *
   * A payload that is not valid base64 is dropped; the resequencer treats the
   * hole it leaves like any other lost frame.
   */
  push(speakerSocketId: string, sequence: number, sampleRate: number, payloadB64: string): void {
    let samples: Int16Array;
    try {
      samples = decodePcm16(payloadB64);
    } catch {
      return;
    }
    this.getOrCreate(speakerSocketId, sampleRate).resequencer.push(sequence, {
      samples,
      sampleRate,
    });
  }

  /** Release one speaker's context — they left the room. */
  forget(speakerSocketId: string): void {
    const sink = this.speakers.get(speakerSocketId);
    if (!sink) return;
    this.release(sink);
    this.speakers.delete(speakerSocketId);
  }

  /** Release all AudioContexts and discard all queued audio. */
  close(): void {
    for (const sink of this.speakers.values()) this.release(sink);
    this.speakers.clear();
  }

  /**
   * True when at least one speaker's AudioContext is 'suspended' (autoplay
   * policy). Drives the "tap to enable sound" affordance.
   */
  isAnySuspended(): boolean {
    for (const sink of this.speakers.values()) {
      if (sink.ctx.state === 'suspended') return true;
    }
    return false;
  }

  /** Resume every suspended context. Call from a user-gesture handler. */
  async resumeAll(): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const sink of this.speakers.values()) {
      if (sink.ctx.state === 'suspended') pending.push(sink.ctx.resume());
    }
    await Promise.all(pending);
  }

  private release(sink: SpeakerSink): void {
    sink.resequencer.close();
    sink.queue.stop();
    void sink.ctx.close().catch(() => undefined);
  }

  private getOrCreate(speakerSocketId: string, sampleRate: number): SpeakerSink {
    const existing = this.speakers.get(speakerSocketId);
    if (existing) return existing;

    const ctx = new AudioContext({ sampleRate });
    // Succeeds when a user gesture is already in the chain (the lobby click);
    // otherwise `isAnySuspended()` reports it and the page offers the tap.
    void ctx.resume().catch(() => undefined);
    const queue = new PcmPlaybackQueue(ctx);
    const sink: SpeakerSink = {
      ctx,
      queue,
      // turnKey is the speaker, so all of one speaker's frames share a single
      // Web Audio timeline and play gaplessly end to end.
      resequencer: new FrameResequencer<PcmFrame>({
        onFrame: (frame) => queue.enqueue(speakerSocketId, frame.samples, frame.sampleRate),
      }),
    };
    this.speakers.set(speakerSocketId, sink);
    return sink;
  }
}
