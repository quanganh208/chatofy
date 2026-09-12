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

/**
 * How often a growing utterance is re-read, at most — the floor of the cadence.
 */
const DEFAULT_CADENCE_MS = 300;

/**
 * How much idle time a partial decode must buy, in multiples of its own cost.
 *
 * The cadence is NOT fixed: after a decode that took `d` ms, the next read
 * waits until `d * 3` ms have passed since the previous one STARTED. A fixed
 * cadence let the preview path take a whole lane the moment decodes got slow —
 * slower decodes bought the scheduler a HIGHER share of the engine, because the
 * in-flight guard only prevents overlap, never re-arms after a slow tick. That
 * loop is why this divisor exists: idle time proportional to work done bounds
 * each capturing turn to about a third of one engine, whatever the machine or
 * the language. 3 keeps a fast machine exactly as it was (a 100ms decode never
 * reaches the 300ms floor) and stretches a loaded one — an 8s English window
 * measured at ~250ms per decode refreshes roughly every 750ms.
 */
const PARTIAL_DUTY_DIVISOR = 3;

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

/**
 * Least audio worth handing the recogniser.
 *
 * Measured against the running sidecar on this machine: the Vietnamese
 * Zipformer refuses everything at or below 82ms — HTTP 500 out of its first
 * convolution, `Invalid input shape: {2,80}` — and accepts from 85ms up. The
 * English Moonshine model takes 10ms happily, so this is a floor one engine
 * needs and the other does not; the scheduler applies it to both because the
 * engine is chosen downstream by direction, out of sight from here.
 *
 * Without it the first frame of every turn starts a read on one ~21ms block and
 * that read always fails. The failure is swallowed by design — a live
 * transcript may not put an error in front of someone mid-sentence — so it
 * costs a request per turn and says nothing anywhere the speaker can see.
 *
 * Set above the measured boundary rather than at it, and it still costs no
 * latency: a turn opens carrying `PRE_ROLL_MS` (320ms in `capture-pump.ts`) of
 * audio already captured, so the first read happens on the same burst of frames
 * it always did — just further into it.
 */
const MIN_AUDIO_MS = 200;

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
  /** Cost of the last decode, measured start-to-settle. 0 until one settles. */
  private lastDecodeMs = 0;

  constructor(options: PartialTranscriptSchedulerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.cadenceMs = options.cadenceMs ?? DEFAULT_CADENCE_MS;
    this.windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  }

  /**
   * Whether to start reading now.
   *
   * A tick still running is never joined by a second one. Past that, the gate
   * is `max(cadence, duty × last cost)` since the previous START, so a slow
   * decode buys idle time proportional to its own cost — the preview path can
   * never price itself into a whole lane just because the machine got slower.
   */
  shouldStart(bufferedBytes: number, bytesPerSecond: number): boolean {
    if (this.inFlight) return false;
    // Covers an empty turn too: the rate is fixed by a frame the schema holds
    // at 8 kHz or more, so the floor is never zero.
    if (bufferedBytes < (MIN_AUDIO_MS / 1000) * bytesPerSecond) return false;
    // Re-reading identical audio would spend a decode to arrive at the text
    // already on screen.
    if (bufferedBytes === this.startedAtBytes) return false;
    const interval = Math.max(
      this.cadenceMs,
      this.lastDecodeMs * PARTIAL_DUTY_DIVISOR,
    );
    return this.now() - this.lastStartedAt >= interval;
  }

  markStarted(bufferedBytes: number): void {
    this.inFlight = true;
    this.lastStartedAt = this.now();
    this.startedAtBytes = bufferedBytes;
  }

  markSettled(): void {
    this.inFlight = false;
    // Measured here rather than by the caller: the elapsed time from start to
    // settle is exactly what the duty gate needs, and it is already in this
    // class's hands.
    this.lastDecodeMs = Math.max(0, this.now() - this.lastStartedAt);
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
