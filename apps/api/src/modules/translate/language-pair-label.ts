import type { LanguagePair } from '@chatofy/types';

/**
 * How a language pair is written in a log line: `vi→en`.
 *
 * One formatter so every log a query might grep for spells the pair the same
 * way. These lines used to print the `vi_to_en` direction string, so a saved
 * log query on that spelling has to follow.
 */
export function languagePairLabel(pair: LanguagePair): string {
  return `${pair.source}→${pair.target}`;
}
