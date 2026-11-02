import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';

/**
 * How much a turn is allowed to spend on paid model calls beyond its one
 * final translation.
 *
 * Every field's default is what the turn did before these knobs existed, so an
 * unset environment changes nothing. Each was added because the replay
 * baseline (`plans/reports/benchmark-261102-1151-call-budget-baseline.md`,
 * 10.4 calls a turn) showed its lane spending at least a fifth of the calls,
 * and each is switched on only after a replay arm measures what it costs.
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
   * translated again (`LIVE_TRANSLATION_COMMIT_CHARS`). 2 asks for roughly half
   * as many previews, at the price of a provisional line that moves in bigger
   * steps.
   */
  liveCommitScale: number;
}

/** What every turn did before the knobs existed. */
export const DEFAULT_COST_POLICY: Readonly<TranslationCostPolicy> =
  Object.freeze({
    speculationOverlap: true,
    speculationHomophones: true,
    liveCommitScale: 1,
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
