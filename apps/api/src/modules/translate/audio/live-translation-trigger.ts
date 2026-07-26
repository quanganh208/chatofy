/**
 * Decides when a sentence still being spoken is worth translating early.
 *
 * Unlike the live transcript next door, every yes here is a metered request
 * against a per-minute ceiling that this system has already been measured
 * bumping into — and when that ceiling is hit, the request that suffers is the
 * one the speaker is actually waiting for. So the question is not "has anything
 * changed" but "is this turn long enough that showing a provisional translation
 * beats spending the quota".
 *
 * Short turns answer that themselves. A two-second sentence has its real
 * translation on screen within about a second of the speaker stopping; putting
 * a guess up first would cost a request to save nothing. The turns worth
 * spending on are the long ones, where the wait is long enough to feel.
 */

/**
 * Speech a turn must already contain before its first provisional translation.
 *
 * Below this the finished translation arrives sooner than a guess would be
 * worth reading.
 */
const MIN_SPEECH_SECONDS = 3;

/** Shortest gap between two provisional translations of the same turn. */
const MIN_INTERVAL_MS = 2_500;

/**
 * New words that justify translating again before the interval is up.
 *
 * A sentence can change meaning in a few words — a negation, a different
 * object — so waiting out the full interval on a fast speaker would leave the
 * screen showing a translation the speech has already contradicted.
 */
const WORDS_FOR_EARLY_REFRESH = 12;

/**
 * Provisional translations one turn may spend.
 *
 * The turn keeps working past this; it simply stops guessing, and the endpoint
 * translates once as it always would.
 */
const MAX_PER_TURN = 3;

export interface LiveTranslationTriggerOptions {
  now?: () => number;
  minSpeechSeconds?: number;
  minIntervalMs?: number;
  wordsForEarlyRefresh?: number;
  maxPerTurn?: number;
}

const wordCount = (text: string): number =>
  text.trim() ? text.trim().split(/\s+/).length : 0;

export class LiveTranslationTrigger {
  private readonly now: () => number;
  private readonly minSpeechSeconds: number;
  private readonly minIntervalMs: number;
  private readonly wordsForEarlyRefresh: number;
  private readonly maxPerTurn: number;

  private inFlight = false;
  private spent = 0;
  private lastAt = Number.NEGATIVE_INFINITY;
  private lastWords = 0;

  constructor(options: LiveTranslationTriggerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.minSpeechSeconds = options.minSpeechSeconds ?? MIN_SPEECH_SECONDS;
    this.minIntervalMs = options.minIntervalMs ?? MIN_INTERVAL_MS;
    this.wordsForEarlyRefresh =
      options.wordsForEarlyRefresh ?? WORDS_FOR_EARLY_REFRESH;
    this.maxPerTurn = options.maxPerTurn ?? MAX_PER_TURN;
  }

  /**
   * Whether the transcript so far is worth translating now.
   *
   * `seconds` is how much speech the turn has accumulated, `transcript` the
   * live reading of it.
   */
  shouldTranslate(transcript: string, seconds: number): boolean {
    if (this.inFlight) return false;
    if (this.spent >= this.maxPerTurn) return false;
    if (seconds < this.minSpeechSeconds) return false;

    const words = wordCount(transcript);
    if (words === 0) return false;
    // Re-translating the same words would buy the text already on screen.
    if (words <= this.lastWords) return false;

    if (words - this.lastWords >= this.wordsForEarlyRefresh) return true;
    return this.now() - this.lastAt >= this.minIntervalMs;
  }

  markStarted(transcript: string): void {
    this.inFlight = true;
    this.spent += 1;
    this.lastAt = this.now();
    this.lastWords = wordCount(transcript);
  }

  markSettled(): void {
    this.inFlight = false;
  }

  /** Requests this turn has spent, so the cost can be recorded, not inferred. */
  get spentCount(): number {
    return this.spent;
  }
}
