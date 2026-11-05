/**
 * How a conversation runs, decided from the language pair alone.
 *
 * One source picker sets it (the same rule web's /translate follows, see
 * `docs/architecture/contracts-and-languages.md`): a named source makes a
 * vi↔en conversation two-way, `detect` identifies each turn and translates it
 * into the target, and a pair with Chinese stays one-way because Chinese is not
 * identified. What the server then GRANTS is read from `server.session.ready`;
 * the answer here is only what to ask for.
 */

import {
  AUTO_DETECT,
  LANGUAGE_CODES,
  canIdentify,
  defaultTargetFor,
  detectConversationLanguages,
  pairLanguages,
  type LanguageCode,
  type SessionLanguagePair,
} from '@chatofy/types';

export type SourceChoice = LanguageCode | typeof AUTO_DETECT;

/** Whether this pair is one the picker may hold: two different languages, detect only where it works. */
export function isValidPair(pair: SessionLanguagePair): boolean {
  if (pair.source === pair.target) return false;
  if (pair.source === AUTO_DETECT) return canIdentify(pair, false);
  return true;
}

/** The sources offered for a target: every other language, then Auto-detect where it can work. */
export function sourceChoices(target: LanguageCode): SourceChoice[] {
  const named: SourceChoice[] = LANGUAGE_CODES.filter((code) => code !== target);
  const detect: SessionLanguagePair = { source: AUTO_DETECT, target };
  return canIdentify(detect, false) ? [...named, AUTO_DETECT] : named;
}

/** Whether a start in `pair` asks the server for a two-way conversation. */
export function asksTwoWay(pair: SessionLanguagePair): boolean {
  return pair.source !== AUTO_DETECT && canIdentify(pair, true);
}

/** The pair after the user picks a source; the target is kept. */
export function withSource(pair: SessionLanguagePair, source: SourceChoice): SessionLanguagePair {
  return source === pair.target ? pair : normalizePair({ source, target: pair.target });
}

/**
 * The pair after the user picks a target. Picking the current source swaps the two,
 * so the picker never lands on "Vietnamese to Vietnamese"; an Auto-detect source
 * that the new target cannot support falls back to a named one.
 */
export function withTarget(pair: SessionLanguagePair, target: LanguageCode): SessionLanguagePair {
  if (target === pair.target) return pair;
  if (pair.source === target) {
    return normalizePair({ source: pair.target, target });
  }
  return normalizePair({ source: pair.source, target });
}

/** Exchanges the sides. Auto-detect has no language to become a target, so it does not swap. */
export function swapPair(pair: SessionLanguagePair): SessionLanguagePair | null {
  if (pair.source === AUTO_DETECT) return null;
  return { source: pair.target, target: pair.source };
}

/** A pair the picker can hold, repaired when it cannot (a stored value, or a changed target). */
export function normalizePair(pair: SessionLanguagePair): SessionLanguagePair {
  if (isValidPair(pair)) return pair;
  const source: SourceChoice =
    pair.source === pair.target || pair.source === AUTO_DETECT
      ? (sourceChoices(pair.target).find((choice) => choice !== AUTO_DETECT) ??
        defaultTargetFor(pair.target))
      : pair.source;
  return { source, target: pair.target };
}

/** The languages a conversation in `pair` is stored under, declared source first. */
export function storedLanguages(pair: SessionLanguagePair): LanguageCode[] {
  return pair.source === AUTO_DETECT
    ? detectConversationLanguages(pair.target)
    : pairLanguages({ source: pair.source, target: pair.target });
}
