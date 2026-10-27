/**
 * Per-speaker ordering of translated-speech frames.
 *
 * Each speaker's frames carry THAT speaker's translation leg's counter for the
 * listener's language, which keeps counting for the whole call, across turns
 * and translate-socket restarts. So a listener cannot assume sequence 0: the cursor starts at the first sequence seen per
 * speaker. Frames play in order; a frame that arrives early waits for its
 * predecessor, but never for long — if the gap is still open after
 * {@link GAP_SKIP_MS}, or more than {@link MAX_BUFFERED_FRAMES} frames are waiting,
 * the cursor skips to the earliest buffered frame. One lost frame therefore costs
 * a moment of audio, not the speaker for the rest of the call, and the buffer is
 * bounded.
 *
 * Pure (no audio APIs); the timer is injectable for tests.
 */

/** How long a missing frame may hold back the frames behind it. */
const GAP_SKIP_MS = 500;

/** Most frames held behind a gap before it is skipped without waiting. */
const MAX_BUFFERED_FRAMES = 50;

export interface ResequencerTimers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

export interface ResequencerOptions<T> {
  /** Receives each frame, in order, exactly once. */
  play: (speakerId: string, frame: T) => void;
  gapSkipMs?: number;
  maxBufferedFrames?: number;
  timers?: ResequencerTimers;
}

interface Pending<T> {
  sequence: number;
  frame: T;
}

interface SpeakerCursor<T> {
  /** Next sequence to play. */
  nextSeq: number;
  /** Frames waiting for `nextSeq`, kept sorted by sequence. */
  buffer: Pending<T>[];
  /** Pending gap-skip timer, armed while the buffer is blocked. */
  gapTimer: unknown;
}

const defaultTimers: ResequencerTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class TranslationAudioResequencer<T> {
  private readonly speakers = new Map<string, SpeakerCursor<T>>();
  private readonly play: (speakerId: string, frame: T) => void;
  private readonly gapSkipMs: number;
  private readonly maxBufferedFrames: number;
  private readonly timers: ResequencerTimers;

  constructor(options: ResequencerOptions<T>) {
    this.play = options.play;
    this.gapSkipMs = options.gapSkipMs ?? GAP_SKIP_MS;
    this.maxBufferedFrames = options.maxBufferedFrames ?? MAX_BUFFERED_FRAMES;
    this.timers = options.timers ?? defaultTimers;
  }

  push(speakerId: string, sequence: number, frame: T): void {
    if (!Number.isInteger(sequence) || sequence < 0) return;

    let cursor = this.speakers.get(speakerId);
    if (!cursor) {
      cursor = { nextSeq: sequence, buffer: [], gapTimer: null };
      this.speakers.set(speakerId, cursor);
    }

    if (sequence < cursor.nextSeq) {
      // Far behind the cursor means the speaker's leg started over (a rejoin
      // restarts its counter); anything else is a duplicate or a frame that
      // was already skipped.
      if (cursor.nextSeq - sequence <= this.maxBufferedFrames) return;
      this.cancelGapTimer(cursor);
      cursor.nextSeq = sequence;
      cursor.buffer = [];
    }

    if (cursor.buffer.some((p) => p.sequence === sequence)) return;
    cursor.buffer.push({ sequence, frame });
    cursor.buffer.sort((a, b) => a.sequence - b.sequence);
    this.drain(speakerId, cursor);
  }

  /** Forget a speaker (they left the room). */
  removeSpeaker(speakerId: string): void {
    const cursor = this.speakers.get(speakerId);
    if (!cursor) return;
    this.cancelGapTimer(cursor);
    this.speakers.delete(speakerId);
  }

  /** Drop every buffered frame and pending timer. */
  clear(): void {
    for (const cursor of this.speakers.values()) this.cancelGapTimer(cursor);
    this.speakers.clear();
  }

  private drain(speakerId: string, cursor: SpeakerCursor<T>): void {
    while (cursor.buffer.length > 0) {
      const head = cursor.buffer[0];
      if (head === undefined) break;
      if (head.sequence !== cursor.nextSeq) break;
      cursor.buffer.shift();
      cursor.nextSeq = head.sequence + 1;
      this.play(speakerId, head.frame);
    }

    if (cursor.buffer.length === 0) {
      this.cancelGapTimer(cursor);
      return;
    }

    // Blocked behind a gap.
    if (cursor.buffer.length > this.maxBufferedFrames) {
      this.skipGap(speakerId, cursor);
      return;
    }
    if (cursor.gapTimer === null) {
      cursor.gapTimer = this.timers.set(() => {
        cursor.gapTimer = null;
        // The speaker may have left, or the sink been cleared, meanwhile.
        if (this.speakers.get(speakerId) !== cursor) return;
        this.skipGap(speakerId, cursor);
      }, this.gapSkipMs);
    }
  }

  private skipGap(speakerId: string, cursor: SpeakerCursor<T>): void {
    this.cancelGapTimer(cursor);
    const head = cursor.buffer[0];
    if (head === undefined) return;
    cursor.nextSeq = head.sequence;
    this.drain(speakerId, cursor);
  }

  private cancelGapTimer(cursor: SpeakerCursor<T>): void {
    if (cursor.gapTimer !== null) {
      this.timers.clear(cursor.gapTimer);
      cursor.gapTimer = null;
    }
  }
}
