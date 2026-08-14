/**
 * Turns a transcript into tokens that can be compared across successive reads.
 *
 * Exists because two reads of the same speech can disagree about spelling while
 * agreeing about words. Measured on the English recogniser, re-reading a growing
 * buffer every 300ms:
 *
 *   "at a time" -> "at set." -> "at seven in the morning"
 *               -> "at 7 in the Eve" -> "at seven in the evening"
 *
 * `seven` becoming `7` is the whole reason this file is here. Compared raw, that
 * is a word already spoken aloud being contradicted, and the commit policy would
 * count a violation and refuse to move on every long English turn. Compared as
 * normalized tokens it is the same word twice.
 *
 * The normalized form is ONLY ever used to compare. Text handed to translation
 * is always the original: casing and digits carry meaning a translator uses, and
 * this function throws both away on purpose.
 */

/**
 * Number words the recognisers alternate with digits, per language.
 *
 * Only 0-20 and the round tens. Past that, recognisers in both languages emit
 * digits consistently enough that the spelled form never appeared in any
 * measured read, and a longer table is more surface to get wrong than value to
 * gain. A digit with no entry here simply stays a digit — both reads spell it
 * the same way, so comparison still works.
 */
const NUMBER_WORDS: Record<'vi' | 'en', Record<string, string>> = {
  en: {
    '0': 'zero',
    '1': 'one',
    '2': 'two',
    '3': 'three',
    '4': 'four',
    '5': 'five',
    '6': 'six',
    '7': 'seven',
    '8': 'eight',
    '9': 'nine',
    '10': 'ten',
    '11': 'eleven',
    '12': 'twelve',
    '13': 'thirteen',
    '14': 'fourteen',
    '15': 'fifteen',
    '16': 'sixteen',
    '17': 'seventeen',
    '18': 'eighteen',
    '19': 'nineteen',
    '20': 'twenty',
    '30': 'thirty',
    '40': 'forty',
    '50': 'fifty',
    '60': 'sixty',
    '70': 'seventy',
    '80': 'eighty',
    '90': 'ninety',
  },
  vi: {
    '0': 'không',
    '1': 'một',
    '2': 'hai',
    '3': 'ba',
    '4': 'bốn',
    '5': 'năm',
    '6': 'sáu',
    '7': 'bảy',
    '8': 'tám',
    '9': 'chín',
    '10': 'mười',
    '11': 'mười một',
    '12': 'mười hai',
    '13': 'mười ba',
    '14': 'mười bốn',
    '15': 'mười lăm',
    '16': 'mười sáu',
    '17': 'mười bảy',
    '18': 'mười tám',
    '19': 'mười chín',
    '20': 'hai mươi',
    '30': 'ba mươi',
    '40': 'bốn mươi',
    '50': 'năm mươi',
    '60': 'sáu mươi',
    '70': 'bảy mươi',
    '80': 'tám mươi',
    '90': 'chín mươi',
  },
};

/**
 * Punctuation dropped before comparing.
 *
 * The Vietnamese streaming recogniser emits punctuation and the offline one did
 * not, so the same words can arrive punctuated or bare depending on which engine
 * is loaded. Punctuation also appears and disappears between reads as the model
 * revises where a sentence ends, which is a boundary decision, not a word one.
 * The clause splitter reads punctuation from the ORIGINAL text; this comparison
 * path does not need it.
 */
const PUNCTUATION = /[.,!?;:…"'`(){}[\]<>«»„“”‘’\-–—]/g;

export type NormalizerLanguage = 'vi' | 'en';

/**
 * Split a transcript into comparable tokens.
 *
 * Lowercases, strips punctuation, and expands small digits to their spoken form
 * in the given language. Returns an empty array for blank input.
 */
export function normalizeForComparison(
  text: string,
  language: NormalizerLanguage,
): string[] {
  const words = NUMBER_WORDS[language];
  return text
    .toLowerCase()
    .replace(PUNCTUATION, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((token) => {
      const spelled = words[token];
      // A multi-word expansion ("mười một") has to become multiple tokens, or a
      // read that spelled it out would never line up with one that used digits.
      return spelled === undefined ? [token] : spelled.split(' ');
    });
}

/**
 * Length of the longest shared prefix of two token sequences.
 *
 * The core comparison for every rule in the commit policy: how much of what we
 * have already said does this new read still support?
 */
export function commonPrefixLength(a: string[], b: string[]): number {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a[index] === b[index]) index += 1;
  return index;
}
