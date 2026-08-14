// What kind of wrong a translation is, and therefore which lever fixes it.
//
// The point of a taxonomy is not to count errors. It is to stop the same
// argument happening every time the output is bad: "the translation is worse
// than it should be" has no next action, while "eleven of these fourteen errors
// are tone-only on proper nouns" does, and it is a different action from the one
// "six of them invented a clause ending" calls for.
//
// Only the mechanically decidable categories are automatic. A geographic or
// factual error cannot be detected by comparing strings — it needs someone who
// knows the subject — so those arrive as a `label` on the row and are tallied
// beside the automatic ones rather than guessed at. A classifier that guessed
// would produce a category whose count nobody could act on.
import {
  foldForMatch,
  normalizeTranscript,
} from '../../packages/ai-providers/dist/index.js';

/**
 * Every category, with the lever it points at.
 *
 * The lever is the reason the category exists. A category nobody can act on is
 * a category to delete.
 */
export const CATEGORIES = {
  'untranslated-passthrough': {
    severity: 'high',
    lever: 'The model echoed the source instead of translating. Check the direction and Rule 1.',
  },
  'tone-or-diacritic': {
    severity: 'high',
    lever: 'Add the word to session hotwords — this is the failure hints exist for.',
  },
  'number-mismatch': {
    severity: 'high',
    lever:
      'The digits changed. Identifiers are read digit by digit downstream, so a wrong one is spoken confidently. Check the number rule in the instruction.',
  },
  invention: {
    severity: 'high',
    lever:
      'The output carries substantially more than the reference — the shape of a completed fragment. Rule 5 is not holding; re-run the fragment cases in benchmarks/prompt-injection.',
  },
  truncation: {
    severity: 'high',
    lever: 'The output stops well short of the reference. Check clause splitting and finishReason.',
  },
  'casing-punctuation': {
    severity: 'low',
    lever: 'Cosmetic only. Usually not worth a prompt change.',
  },
  'lexical-or-semantic': {
    severity: 'medium',
    lever:
      'The words genuinely differ. Label it by hand (geographic, factual, register, homophone) — string comparison cannot tell you which.',
  },
  exact: {
    severity: 'none',
    lever: 'No difference. Not an error.',
  },
};

/** Digit runs, in order. Spelled-out numbers are deliberately not matched. */
const digitsOf = (text) => text.match(/\d+/g) ?? [];

/**
 * Case- and punctuation-insensitive, but diacritics INTACT.
 *
 * The distinction this file turns on. `foldForMatch` strips case, punctuation
 * AND diacritics together, so it cannot tell "Xin chào, bạn!" from "xin chào
 * bạn" — a cosmetic difference — apart from "Quang Ninh" against "Quảng Ninh",
 * which is the error hotwords exist to fix. Keeping the marks here is what makes
 * the two separable, and is why the cosmetic check must run first.
 */
const caseAndPunctuationFold = (text) =>
  normalizeTranscript(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * How far apart two strings are in length, as a ratio of the reference.
 *
 * Word count rather than characters: Vietnamese and English disagree sharply on
 * characters per word, and this file has to judge both directions with one
 * threshold.
 */
const wordCount = (text) => foldForMatch(text).split(' ').filter(Boolean).length;

/**
 * Thresholds for calling a length difference an error.
 *
 * Wide on purpose. A correct translation routinely runs 30% longer or shorter
 * than a reference, so anything tighter reports ordinary variance as invention
 * — and a category that fires on correct output is one nobody reads.
 */
export const INVENTION_RATIO = 1.6;
export const TRUNCATION_RATIO = 0.55;

/**
 * Guards that stop a ratio being computed where it means nothing.
 *
 * A ratio is unreliable on a short utterance: "Can you send that over" against
 * "Could you please send that over to me" is 5 words to 8, which trips a 1.6
 * ratio while being one added politeness phrase and a perfectly good
 * translation. Requiring a floor on the reference AND an absolute gap is what
 * separates that from a genuinely completed fragment, where both are large.
 *
 * Below the floor the row falls through to `lexical-or-semantic`, which is the
 * honest answer: on five words, length carries no evidence either way.
 */
export const MIN_REFERENCE_WORDS_FOR_RATIO = 6;
export const MIN_ABSOLUTE_WORD_GAP = 3;

/**
 * Which length verdict the row earns, or null when length says nothing.
 */
function lengthVerdict(hypothesis, reference) {
  const referenceWords = wordCount(reference);
  const hypothesisWords = wordCount(hypothesis);
  if (referenceWords < MIN_REFERENCE_WORDS_FOR_RATIO) return null;
  if (Math.abs(hypothesisWords - referenceWords) < MIN_ABSOLUTE_WORD_GAP) return null;

  const ratio = hypothesisWords / referenceWords;
  if (ratio >= INVENTION_RATIO) return 'invention';
  if (ratio <= TRUNCATION_RATIO) return 'truncation';
  return null;
}

/**
 * Classify one row, automatically where that is decidable.
 *
 * Order matters: the checks run cheapest-and-most-certain first, and the first
 * match wins. `exact` before everything so a correct row is never explained;
 * passthrough before the rest because an untranslated output would otherwise be
 * described by whichever difference it happens to have.
 */
export function classify({ source, hypothesis, reference }) {
  if (!reference) {
    throw new Error('classify needs a reference; a row without one cannot be judged');
  }
  const hyp = String(hypothesis ?? '');
  const ref = String(reference);

  if (hyp === ref) return 'exact';

  // The source echoed back. Checked against the SOURCE, not the reference,
  // which is what distinguishes "did not translate" from "translated badly".
  if (source && foldForMatch(hyp) === foldForMatch(source)) return 'untranslated-passthrough';

  // Cosmetic BEFORE tonal, and the order is load-bearing. Both differences
  // vanish under `foldForMatch`, so asking the tonal question first would
  // answer it "yes" for a row whose marks are in fact identical and whose only
  // difference is a comma — sending someone to add a hotword for a comma.
  if (caseAndPunctuationFold(hyp) === caseAndPunctuationFold(ref)) return 'casing-punctuation';

  // Marks differ, everything else survives folding: the signature Vietnamese
  // recognition failure, and the one hints were built for.
  if (foldForMatch(hyp) === foldForMatch(ref)) return 'tone-or-diacritic';

  if (digitsOf(hyp).join(',') !== digitsOf(ref).join(',')) return 'number-mismatch';

  return lengthVerdict(hyp, ref) ?? 'lexical-or-semantic';
}

/**
 * Tally rows by automatic category and by hand-written label.
 *
 * The two are kept apart in the output because they are different kinds of
 * claim: one is a fact about two strings, the other is a judgement someone made.
 * Merging them would produce a single table where nobody can tell which is which.
 */
export function tally(rows) {
  const byCategory = new Map();
  const byLabel = new Map();
  const examples = new Map();

  for (const row of rows) {
    const category = classify(row);
    byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
    if (category !== 'exact' && !examples.has(category)) examples.set(category, row);
    if (row.label) byLabel.set(row.label, (byLabel.get(row.label) ?? 0) + 1);
  }

  return {
    total: rows.length,
    byCategory: Object.fromEntries([...byCategory].sort((a, b) => b[1] - a[1])),
    byLabel: Object.fromEntries([...byLabel].sort((a, b) => b[1] - a[1])),
    examples: Object.fromEntries(examples),
    unlabelled: rows.filter((row) => !row.label && classify(row) === 'lexical-or-semantic').length,
  };
}
