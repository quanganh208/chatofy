// Deterministic keep-verbatim enforcement — the second half of the glossary's
// hybrid strategy.
//
// A glossary PAIR is prompt-bias only: the model is asked to prefer a rendering
// and may still inflect or reorder it, which is correct — that is translation. A
// keep-verbatim entry is different: it names a proper noun (a brand or product
// name) that must appear UNCHANGED. The prompt asks the model to keep it as
// written; this pass is the safety net for when the model altered only its
// CASING or tone marks, normalizing an occurrence back to the canonical spelling.
//
// Deliberately conservative: it only CANONICALIZES a run of words already
// present in the output whose folded form equals the term. It never INSERTS a
// term the output does not contain — reinserting a name the model translated
// away would be putting a word into a sentence, the one thing the whole glossary
// design refuses to do (see prompt-builder.ts). If the model dropped or
// translated the name outright, this pass leaves the output alone.
import type { GlossaryTerm, LanguageCode } from '@chatofy/types';
import { foldForMatch } from './vietnamese.js';

/** A word token in the output, with the offsets that bound it in the source string. */
interface WordToken {
  raw: string;
  start: number;
  end: number;
}

interface VerbatimTerm {
  /** The exact spelling to enforce wherever the term is found. */
  canonical: string;
  /** The term's words, folded — the identity an output run must match to canonicalize. */
  foldedWords: string[];
}

/** Matches the maximal runs of letters/digits; punctuation and spacing fall between them. */
const WORD = /[\p{L}\p{N}]+/gu;

/**
 * Canonicalize every keep-verbatim term where it already appears in `text`.
 *
 * `targetLanguage` picks which spelling is canonical — the output is in the
 * target language, so a name is rendered in its target-column form. Ordinary
 * (non-keep-verbatim) pairs are ignored here; they are the prompt's job.
 */
export function enforceVerbatimTerms(
  text: string,
  terms: readonly GlossaryTerm[] | undefined,
  targetLanguage: LanguageCode,
): string {
  const verbatim = buildVerbatimTerms(terms, targetLanguage);
  let out = text;
  for (const term of verbatim) {
    out = canonicalizeOccurrences(out, term);
  }
  return out;
}

function buildVerbatimTerms(
  terms: readonly GlossaryTerm[] | undefined,
  targetLanguage: LanguageCode,
): VerbatimTerm[] {
  const built: VerbatimTerm[] = [];
  for (const term of terms ?? []) {
    if (!term.keepVerbatim) continue;
    const canonical = term[targetLanguage];
    const foldedWords = foldForMatch(canonical).split(' ').filter(Boolean);
    if (foldedWords.length) built.push({ canonical, foldedWords });
  }
  // Longest first (by word count, then characters) so a multi-word name is
  // canonicalized before a shorter name that is a prefix of it.
  built.sort(
    (a, b) =>
      b.foldedWords.length - a.foldedWords.length || b.canonical.length - a.canonical.length,
  );
  return built;
}

/** Replace each non-overlapping word-run whose folded form equals the term. */
function canonicalizeOccurrences(text: string, term: VerbatimTerm): string {
  const tokens: WordToken[] = [...text.matchAll(WORD)].map((m) => ({
    raw: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }));

  const n = term.foldedWords.length;
  const spans: { start: number; end: number }[] = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    let hit = true;
    for (let j = 0; j < n; j++) {
      if (foldForMatch(tokens[i + j]!.raw) !== term.foldedWords[j]) {
        hit = false;
        break;
      }
    }
    if (hit) {
      spans.push({ start: tokens[i]!.start, end: tokens[i + n - 1]!.end });
      i += n - 1; // Non-overlapping: skip the tokens this match consumed.
    }
  }
  if (!spans.length) return text;

  // Rebuild the string, replacing only the matched word-spans. Everything
  // between them — punctuation, spacing — is copied through untouched.
  let result = '';
  let cursor = 0;
  for (const span of spans) {
    result += text.slice(cursor, span.start) + term.canonical;
    cursor = span.end;
  }
  return result + text.slice(cursor);
}
