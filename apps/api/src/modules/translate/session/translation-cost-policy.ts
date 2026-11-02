import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';

/**
 * How much a turn is allowed to spend on paid model calls beyond its one
 * final translation.
 *
 * Each knob was added because the replay baseline on prod recordings (10.4
 * calls and about 6,930 billed tokens a turn) showed its lane spending at
 * least a fifth of the calls: overlapping speculation wasted 27.8% of
 * translate calls and live previews were 31.2% of all calls. The defaults are
 * the combination a replay arm measured at 5.7 calls (54% of baseline) and 59%
 * of the tokens a turn, with the same final-translation inputs and p50 within
 * 5%. The record is in `docs/development-journey.md` ("A cheaper turn…").
 */
export interface TranslationCostPolicy {
  /**
   * Whether a new speculation may start while the previous one is still in
   * flight.
   *
   * A renewal is only ever asked for after more audio arrived, so the guess it
   * would overlap is already unusable. Off stops paying for that second
   * request; the price is that a guess which would have been the answer is not
   * made, and the turn waits for its final instead.
   */
  speculationOverlap: boolean;
  /**
   * Whether a speculation runs the homophone check on its transcript.
   *
   * The check answers about 5% of the time, and on a turn whose guess is not
   * adopted its answer is thrown away with the guess. Off keeps the recognizer
   * fusion, which answers about 61% of the time, and costs the turns that adopt
   * a guess their homophone corrections.
   */
  speculationHomophones: boolean;
  /**
   * Multiplier on the characters a live preview waits for before it is
   * translated again (`LIVE_TRANSLATION_COMMIT_CHARS`). 3 asks for under half
   * as many previews as 1 (1.5 a turn instead of 3.3 on the replay), at the
   * price of a provisional line that moves in bigger steps. English moves
   * less, because its clause rule fires whatever the scale.
   */
  liveCommitScale: number;
}

/** The measured cheaper turn; the schema defaults say the same. */
export const DEFAULT_COST_POLICY: Readonly<TranslationCostPolicy> =
  Object.freeze({
    speculationOverlap: false,
    speculationHomophones: false,
    liveCommitScale: 3,
  });

/** The policy the environment asks for; unset keys fall back to {@link DEFAULT_COST_POLICY}. */
export function costPolicyFromEnv(
  config: ConfigService<Env, true>,
): TranslationCostPolicy {
  const overlap = config.get('TRANSLATE_SPECULATION_OVERLAP', { infer: true });
  const homophones = config.get('TRANSLATE_SPECULATION_HOMOPHONES', {
    infer: true,
  });
  const scale = config.get('TRANSLATE_LIVE_COMMIT_SCALE', { infer: true });
  return {
    speculationOverlap:
      overlap === undefined
        ? DEFAULT_COST_POLICY.speculationOverlap
        : overlap === 'on',
    speculationHomophones:
      homophones === undefined
        ? DEFAULT_COST_POLICY.speculationHomophones
        : homophones === 'on',
    liveCommitScale:
      typeof scale === 'number' ? scale : DEFAULT_COST_POLICY.liveCommitScale,
  };
}
