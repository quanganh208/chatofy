// The public entry point: pick the language's ITN and run it.
//
// A separate file from the engine because the engine must not import the
// language modules that import IT — the tier tables are built at module load, so
// a cycle would evaluate one of them before its vocabulary existed.
import type { LanguageCode } from '../interfaces/provider-types.js';
import { inverseNormalize, type LanguageItn } from './inverse-normalize.js';
import { VIETNAMESE_ITN } from './vietnamese-inverse-normalize.js';
import { ENGLISH_ITN } from './english-inverse-normalize.js';

/** `vi` is the fallback, matching {@link VOCABULARY}'s own default. */
const BY_LANGUAGE: Record<LanguageCode, LanguageItn> = {
  vi: VIETNAMESE_ITN,
  en: ENGLISH_ITN,
};

/**
 * Typeset the spoken numbers in a finished transcript, changing nothing else.
 *
 * Pure, total, and byte-stable: the same input always returns the same string,
 * and a transcript with no spoken numbers in it returns unchanged — which is
 * what lets the caller emit a display value only when something actually
 * changed, rather than putting a "show original" disclosure under every line in
 * the conversation.
 *
 * The result is DISPLAY text. It must never replace the raw transcript, which
 * stays canonical and is the only thing WER, the translator's context history
 * and the display-fidelity scorer are allowed to see.
 */
export function inverseNormalizeTranscript(text: string, language: LanguageCode): string {
  return inverseNormalize(text, BY_LANGUAGE[language] ?? VIETNAMESE_ITN);
}
