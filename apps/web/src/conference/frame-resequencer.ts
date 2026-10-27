/**
 * Releases one speaker's translated-speech frames in sequence order.
 *
 * `sequence` is the speaker's live-session counter, not a per-listener one: a
 * listener who joins mid-call, or rejoins with a fresh sink, first sees some
 * sequence well above zero. So the expected sequence starts at the FIRST frame
 * seen, not at zero — starting at zero holds every frame forever.
 *
 * A missing frame is waited for, but not indefinitely. The wait ends when the
 * gap is older than `gapTimeoutMs` or more than `maxBuffered` frames are held,
 * whichever comes first; playback then resumes at the earliest held frame and
 * the lost one is skipped. Without that bound one dropped frame silences the
 * speaker for the rest of the call while the buffer grows without limit.
 */

/** How long a gap is waited for before it is skipped. */
export const GAP_TIMEOUT_MS = 500;
/** How many out-of-order frames may be held before a gap is skipped. */
const MAX_BUFFERED_FRAMES = 50;

export interface FrameResequencerOptions<T> {
  onFrame: (frame: T, sequence: number) => void;
  gapTimeoutMs?: number;
  maxBuffered?: number;
}

export class FrameResequencer<T> {
  private nextSeq: number | null = null;
  private readonly held = new Map<number, T>();
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly gapTimeoutMs: number;
  private readonly maxBuffered: number;

  constructor(private readonly options: FrameResequencerOptions<T>) {
    this.gapTimeoutMs = options.gapTimeoutMs ?? GAP_TIMEOUT_MS;
    this.maxBuffered = options.maxBuffered ?? MAX_BUFFERED_FRAMES;
  }

  push(sequence: number, frame: T): void {
    this.nextSeq ??= sequence;
    // Already played, or skipped past: a late duplicate or a frame given up on.
    if (sequence < this.nextSeq) return;
    this.held.set(sequence, frame);

    this.drain();
    if (this.held.size > this.maxBuffered) this.skipGap();
    this.armOrClearGapTimer();
  }

  /** Discard everything held and stop the gap timer. */
  close(): void {
    this.clearGapTimer();
    this.held.clear();
  }

  private drain(): void {
    while (this.nextSeq !== null) {
      const frame = this.held.get(this.nextSeq);
      if (frame === undefined) return;
      this.held.delete(this.nextSeq);
      this.options.onFrame(frame, this.nextSeq);
      this.nextSeq++;
    }
  }

  /** Give up on the missing frame(s): resume at the earliest held sequence. */
  private skipGap(): void {
    if (this.held.size === 0) return;
    this.nextSeq = Math.min(...this.held.keys());
    this.drain();
  }

  private armOrClearGapTimer(): void {
    if (this.held.size === 0) {
      this.clearGapTimer();
      return;
    }
    // Armed once per gap: a stream of later frames must not keep pushing the
    // deadline out, or a gap under steady traffic would never be skipped.
    if (this.gapTimer !== null) return;
    this.gapTimer = setTimeout(() => {
      this.gapTimer = null;
      this.skipGap();
      this.armOrClearGapTimer();
    }, this.gapTimeoutMs);
  }

  private clearGapTimer(): void {
    if (this.gapTimer === null) return;
    clearTimeout(this.gapTimer);
    this.gapTimer = null;
  }
}
