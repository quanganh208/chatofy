import type { Logger } from '@nestjs/common';
import {
  hanCount,
  leaksForeignScript,
  toTargetScript,
} from '@chatofy/ai-providers';
import type { LanguageCode } from '@chatofy/types';
import type { TranslationMap } from '../session/turn-language-plan';
import { languagePairLabel } from '../language-pair-label';

/**
 * Permission for ONE more provider call when a final translation slipped into
 * a script its target is not written in.
 *
 * Measured on 600 recorded zh→vi DeepSeek outputs: 3 left Chinese in the
 * Vietnamese, one of them most of its source sentence. A second call fixes that
 * at the cost of a request against the per-user translation budget, so the
 * caller decides: `allow` checks AND spends the budget, and answers false when
 * it is spent. Only final paths pass one — a provisional preview or a
 * speculation is replaced or retried at the final anyway.
 */
export interface ScriptRetry {
  allow(): boolean;
  /** Names the turn or session in logs, which never carry the text. */
  label: string;
}

type OnChunk = (delta: string, restart: boolean) => void;

/** One provider attempt, streaming into `onChunk` when given one. */
export type TranslateAttempt = (
  onChunk: OnChunk | undefined,
) => Promise<string>;

/** `onChunk` with every piece rendered in the target's script. */
function scripted(
  target: LanguageCode,
  onChunk: OnChunk | undefined,
): OnChunk | undefined {
  return (
    onChunk &&
    ((delta, restart) => onChunk(toTargetScript(target, delta), restart))
  );
}

/**
 * `onChunk` whose first piece starts over: the retry's text REPLACES what the
 * first attempt streamed, and a caller that appended it would splice two
 * translations together.
 */
function restarting(onChunk: OnChunk | undefined): OnChunk | undefined {
  if (!onChunk) return undefined;
  let first = true;
  return (delta, restart) => {
    onChunk(delta, first || restart);
    first = false;
  };
}

/**
 * Run a translation, render it in its target's script, and retry it once if it
 * leaked a foreign script and the caller allows it.
 *
 * Whatever the retry answers is kept: a second leak is the model's answer, and
 * a third call would only spend more of the budget on it. A retry that throws
 * costs nothing — the first answer is returned and the turn goes on.
 */
export async function translateInTargetScript(
  attempt: TranslateAttempt,
  req: {
    text: string;
    source: LanguageCode;
    target: LanguageCode;
    onChunk?: OnChunk;
    scriptRetry?: ScriptRetry;
  },
  logger: Logger,
): Promise<string> {
  const onChunk = scripted(req.target, req.onChunk);
  const first = await attempt(onChunk);
  let text = first;
  if (
    req.scriptRetry &&
    leaksForeignScript(req.source, req.target, req.text, first) &&
    req.scriptRetry.allow()
  ) {
    logger.warn(
      `translation leaked a foreign script, retrying once: ${req.scriptRetry.label} ${languagePairLabel({ source: req.source, target: req.target })} han_in=${hanCount(req.text)} han_out=${hanCount(first)}`,
    );
    try {
      text = await attempt(restarting(onChunk));
    } catch (err) {
      logger.warn(
        `script retry failed, keeping the first answer: ${req.scriptRetry.label} ${
          err instanceof Error ? err.name : 'error'
        }`,
      );
    }
  }
  return toTargetScript(req.target, text);
}

/**
 * The one retry a reused speculation would have had at its final.
 *
 * A speculation is translated without a `ScriptRetry`, and when it is adopted
 * as the turn's answer no final call runs at all — so the check runs here, on
 * the adopted translations, once per target.
 */
export async function retryAdoptedTranslations(
  sourceText: string,
  source: LanguageCode,
  translations: TranslationMap,
  retranslate: (target: LanguageCode) => Promise<string>,
  scriptRetry: ScriptRetry,
  logger: Logger,
): Promise<TranslationMap> {
  const entries = await Promise.all(
    Object.entries(translations).map(async ([code, text]) => {
      const target = code as LanguageCode;
      if (
        text === undefined ||
        !leaksForeignScript(source, target, sourceText, text) ||
        !scriptRetry.allow()
      ) {
        return [target, text] as const;
      }
      logger.warn(
        `adopted speculation leaked a foreign script, retrying once: ${scriptRetry.label} ${languagePairLabel({ source, target })} han_in=${hanCount(sourceText)} han_out=${hanCount(text)}`,
      );
      try {
        return [target, await retranslate(target)] as const;
      } catch {
        return [target, text] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}
