// What credits cost and how long a lease holds them.
//
// 1 credit = 1 caption-minute = 60 credit-seconds. The ledger stores and moves
// integer credit-seconds only; credits are a display unit. These are config
// constants rather than Plan rows because they price USAGE, not purchases, and
// are re-tuned from the cost report once it has data.

/** Live captions only: 1 credit per minute of accepted audio. */
export const CAPTION_CREDITS_PER_MIN = 1;
/** Captions plus spoken output. TTS is local CPU; 2× is a capacity proxy. */
export const VOICE_CREDITS_PER_MIN = 2;
/** One minutes-generation run, flat. Refunded when the pass fails. */
export const MINUTES_RUN_CREDITS = 3;

/** Audio seconds one lease holds credit for, before the multiplier. */
export const LEASE_AUDIO_SECONDS = 120;
/** A session may start only with at least one credit available. */
export const START_MIN_CREDIT_SECONDS = 60;
/** At or under this, the client is told its credits are running low. */
export const LOW_BALANCE_CREDIT_SECONDS = 120;
/**
 * Slack past the lease's own length before the reaper may take it back. A
 * lease's `expiresAt` is last activity + lease length + this grace, so a GC
 * pause or a slow turn end does not hand back credit a live socket still uses.
 */
export const LEASE_GRACE_MS = 60_000;

/** Ceiling on one `credits:grant` run, in whole credits: a typo cannot mint a fortune. */
export const CLI_GRANT_MAX_CREDITS = 10_000;

export interface CreditMultiplierInput {
  /** Whether the turn speaks its translation aloud. */
  voiceOutput: boolean;
  /** Translations beyond the first (a meeting leg's `alsoTranslateInto`). */
  extraTargets: number;
}

/**
 * Credit-seconds charged per second of accepted audio.
 *
 * Every extra target is another translation of the same speech, so it costs
 * another unit; spoken output doubles the whole thing. Captions into one
 * language is 1, voice into one is 2, voice into three is 6.
 */
export function creditMultiplier({
  voiceOutput,
  extraTargets,
}: CreditMultiplierInput): number {
  if (!Number.isSafeInteger(extraTargets) || extraTargets < 0) {
    throw new RangeError(
      `extraTargets must be a non-negative integer, got ${extraTargets}`,
    );
  }
  const perTarget = voiceOutput
    ? VOICE_CREDITS_PER_MIN
    : CAPTION_CREDITS_PER_MIN;
  return (1 + extraTargets) * perTarget;
}
