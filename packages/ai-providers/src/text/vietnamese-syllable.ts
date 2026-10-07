// Which words of a Vietnamese transcript cannot be Vietnamese.
//
// The Vietnamese recognizer has no English vocabulary, so an English word or a
// name comes out as the nearest-sounding letters: "deepfake" as "deep fred" or
// "defec", "VNeID" as "vnei". Most of those letter strings are impossible as
// Vietnamese syllables, and THAT is what this module tests — the shape of a
// syllable, never a list of words. A list was measured and lost: biasing towards
// words nobody said costs real Vietnamese (docs/development-journey.md §3.17),
// and any list misses the vocabulary of the next speaker.
//
// What it cannot see, by construction: an English word heard as real Vietnamese
// syllables ("poker" as "quốc cơ"). Those need the user's own hotwords.
//
// The inventories below are the closed phonotactic sets of the written language
// — every onset, nucleus and coda Vietnamese orthography allows. They are
// structure, like the alphabet, not vocabulary.

/** The five tone marks, as combining characters. Everything else stays. */
const TONE_MARKS = /[\u0300\u0301\u0303\u0309\u0323]/g;

/**
 * Initial consonants, longest first so the alternation never stops early.
 *
 * `gi` and `qu` are written onsets even though `i`/`u` look like vowels; listing
 * them is what lets "giữa" and "quốc" parse.
 */
const ONSET = '(?:ngh|ng|nh|ch|gh|gi|kh|ph|qu|th|tr|b|c|d|đ|g|h|k|l|m|n|p|r|s|t|v|x)?';

/**
 * Vowel nuclei with their glides, as written after the tone marks are removed.
 *
 * Written as an explicit set rather than "one to three vowels" on purpose: the
 * loose form accepts "ee" and "oe" alike, and "deep" would pass as a syllable.
 */
const NUCLEI = [
  'a',
  'ă',
  'â',
  'e',
  'ê',
  'i',
  'y',
  'o',
  'ô',
  'ơ',
  'u',
  'ư',
  'ai',
  'ao',
  'au',
  'ay',
  'âu',
  'ây',
  'eo',
  'êu',
  'ia',
  'iê',
  'iêu',
  'iu',
  'oa',
  'oă',
  'oai',
  'oao',
  'oay',
  'oe',
  'oeo',
  'oi',
  'oo',
  'ôi',
  'ơi',
  'ua',
  'uâ',
  'uây',
  'uê',
  'ui',
  'uô',
  'uôi',
  'uơ',
  'uy',
  'uya',
  'uyê',
  'uyu',
  'ưa',
  'ưi',
  'ươ',
  'ươi',
  'ươu',
  'ưu',
  'yê',
  'yêu',
]
  // Longest first, for the same reason as the onsets.
  .sort((a, b) => b.length - a.length)
  .join('|');

/** Final consonants. Vowel-glide endings are part of {@link NUCLEI}. */
const CODA = '(?:ch|ng|nh|c|m|n|p|t)?';

const SYLLABLE = new RegExp(`^${ONSET}(?:${NUCLEI})${CODA}$`, 'u');

/** A run of letters and digits: one word of a transcript. */
const WORD = /[\p{L}\p{N}]+/gu;

const DIGITS = /^\p{N}+$/u;

/**
 * Whether `word` can be written as one Vietnamese syllable.
 *
 * Case and tone are ignored — tones are free on every syllable shape, so they
 * carry no evidence either way — while the breve, circumflex and horn are kept,
 * because they change the vowel and the vowel decides the shape.
 */
export function isVietnameseSyllable(word: string): boolean {
  const toneless = word.toLowerCase().normalize('NFD').replace(TONE_MARKS, '').normalize('NFC');
  return SYLLABLE.test(toneless);
}

/** A maximal run of words that cannot be Vietnamese, where it sits in the text. */
export interface ForeignSpan {
  /** The words of the run as they appear, joined by single spaces. */
  text: string;
  /** Index of the run's first word among the text's words. */
  firstWord: number;
  /** How many words the run covers. */
  wordCount: number;
}

/**
 * Every maximal run of words that cannot be Vietnamese syllables.
 *
 * Maximal because the recognizer splits one foreign word into several pieces —
 * "deep fred" is one thing heard, and has to be respelled as one. Numbers are
 * never foreign: digits are not syllables, but they are not garbled English
 * either.
 */
export function foreignSpans(text: string): ForeignSpan[] {
  const words = text.normalize('NFC').match(WORD) ?? [];
  const spans: ForeignSpan[] = [];
  let index = 0;
  while (index < words.length) {
    if (DIGITS.test(words[index]!) || isVietnameseSyllable(words[index]!)) {
      index += 1;
      continue;
    }
    const first = index;
    while (
      index < words.length &&
      !DIGITS.test(words[index]!) &&
      !isVietnameseSyllable(words[index]!)
    ) {
      index += 1;
    }
    spans.push({
      text: words.slice(first, index).join(' '),
      firstWord: first,
      wordCount: index - first,
    });
  }
  return spans;
}
