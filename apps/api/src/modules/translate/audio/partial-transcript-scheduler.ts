/**
 * Decides when to re-transcribe a turn that is still being spoken, and whether
 * the answer that comes back is still worth showing.
 *
 * Separate from the session service, and pure apart from the clock, because
 * this is the whole policy and every mistake in it is quiet. A decode that runs
 * too often burns cores the synthesizer needs; one that runs too rarely leaves
 * the screen still while someone is talking, which is the entire problem this
 * feature exists to solve. Neither shows up as a failure — which is exactly the
 * shape of the two defects this project has already shipped.
 */

/** How often a growing utterance is re-read, at most. */
const DEFAULT_CADENCE_MS = 300;

/**
 * Newest audio a partial decode looks at.
 *
 * Every tick re-reads the whole window from scratch, so an uncapped window
 * makes each tick cost more than the last and the gap between updates grow with
 * the turn — worst exactly on the long turns where a live transcript is worth
 * most. Capping trades the beginning of a very long sentence, which the final
 * decode still reads in full and which the viewer has already seen, for a
 * refresh rate that does not decay.
 */
const DEFAULT_WINDOW_SECONDS = 8;

export interface PartialTranscriptSchedulerOptions {
  /** Injected so tests do not sleep. */
  now?: () => number;
  cadenceMs?: number;
  windowSeconds?: number;
}

export class PartialTranscriptScheduler {
  private readonly now: () => number;
  private readonly cadenceMs: number;
  private readonly windowSeconds: number;

  private inFlight = false;
  private lastStartedAt = Number.NEGATIVE_INFINITY;
  private startedAtBytes = -1;
  private emittedAtBytes = -1;

  constructor(options: PartialTranscriptSchedulerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.cadenceMs = options.cadenceMs ?? DEFAULT_CADENCE_MS;
    this.windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  }

  /**
   * Whether to start reading now.
   *
   * A tick still running is never joined by a second one. That, rather than a
   * timer, is what keeps the cost bounded when a decode outlasts the cadence:
   * the rate falls to whatever the machine can actually sustain instead of a
   * queue forming behind it.
   */
  shouldStart(bufferedBytes: number): boolean {
    if (this.inFlight) return false;
    if (bufferedBytes <= 0) return false;
    // Re-reading identical audio would spend a decode to arrive at the text
    // already on screen.
    if (bufferedBytes === this.startedAtBytes) return false;
    return this.now() - this.lastStartedAt >= this.cadenceMs;
  }

  markStarted(bufferedBytes: number): void {
    this.inFlight = true;
    this.lastStartedAt = this.now();
    this.startedAtBytes = bufferedBytes;
  }

  markSettled(): void {
    this.inFlight = false;
  }

  /**
   * Whether a result covering `bufferedBytes` should reach the client.
   *
   * Decodes are not guaranteed to finish in the order they started, and a
   * slower one carrying less audio must not overwrite a newer answer — the
   * transcript would visibly jump backwards mid-sentence.
   */
  shouldEmit(bufferedBytes: number): boolean {
    return bufferedBytes > this.emittedAtBytes;
  }

  markEmitted(bufferedBytes: number): void {
    this.emittedAtBytes = bufferedBytes;
  }

  /**
   * The slice of a turn's audio to read, as a byte offset from the start.
   *
   * Aligned down to a whole sample: cutting between the two bytes of a 16-bit
   * sample shifts every sample after it and turns speech into noise.
   */
  windowStart(bufferedBytes: number, bytesPerSecond: number): number {
    const window = Math.floor(this.windowSeconds * bytesPerSecond);
    if (bufferedBytes <= window) return 0;
    return (bufferedBytes - window) & ~1;
  }
}
