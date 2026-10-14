/**
 * Corrections of a recognizer's transcript, and how one is applied to a line.
 *
 * Two checks produce them, each with its own guard: a word misheard as one
 * that sounds alike (`vietnamese-homophones.ts`), and a stretch a second
 * recognizer heard better (`recognizer-fusion.ts`). Both name a place in the
 * transcript, never a word wherever it occurs, so they share one shape and one
 * way onto the reader's line.
 *
 * `sourceText` never changes. Only the display does, and the client offers the
 * recognizer's words under any line whose display differs.
 */

/** One accepted correction: words as heard at one place, and the words said there. */
export interface TranscriptCorrection {
  /** Consecutive words of the transcript, lowercased, joined by one space. Never empty. */
  heard: string;
  /** The words said instead, lowercased, joined by one space. Never empty. */
  said: string;
  /** Index of the first heard word among the transcript's words. */
  at: number;
}

/** A run of letters and digits: one word. */
export const WORD = /[\p{L}\p{N}]+/gu;

/**
 * `text`'s words, lowercased and NFC, as a correction's `at` counts them.
 *
 * Split before lowercasing, as the line is when a correction is applied:
 * lowercasing first can change the count ("İ" lowercases to "i" and a
 * combining dot, which is no letter).
 */
export function wordsOf(text: string): string[] {
  return (text.normalize('NFC').match(WORD) ?? []).map((word) => word.toLowerCase());
}

/**
 * How many words `text` holds, counted as a correction's `at` counts them, so a
 * caller joining transcripts can move each correction to its place in the whole.
 */
export function countWords(text: string): number {
  return wordsOf(text).length;
}

/** The words a correction covers, as indices into the transcript. */
function covered(correction: TranscriptCorrection): number[] {
  return correction.heard.split(' ').map((_, offset) => correction.at + offset);
}

/**
 * `first` followed by every correction of `second` that touches none of the
 * words a kept correction already covers.
 *
 * Two corrections of the same words would compose into a line neither proposed,
 * so where they meet only the first list's survives.
 */
export function mergeCorrections(
  first: readonly TranscriptCorrection[],
  second: readonly TranscriptCorrection[],
): TranscriptCorrection[] {
  const taken = new Set<number>();
  const merged: TranscriptCorrection[] = [];
  for (const correction of [...first, ...second]) {
    const words = covered(correction);
    if (words.some((index) => taken.has(index))) continue;
    for (const index of words) taken.add(index);
    merged.push(correction);
  }
  return merged;
}

/** `word` written with the case `model` was written in: Capital, UPPER or lower. */
function inCaseOf(model: string, word: string): string {
  if (model.length > 1 && model === model.toUpperCase() && model !== model.toLowerCase()) {
    return word.toUpperCase();
  }
  const first = model.charAt(0);
  return first !== first.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

/**
 * `line` with each correction's words replaced at the place it names.
 *
 * `line` is the transcript or its restore, which keeps the transcript's words
 * and only adds marks and case, so a word index means the same word in both. A
 * correction whose words are not at that index any more is skipped rather than
 * looked for elsewhere, and so is one overlapping a correction before it.
 *
 * Word for word where the counts match, so the punctuation between words stays
 * put and each word keeps its case. Where they differ ("kẻ sọ" for "kè"), the
 * stretch from the first heard word to the last is replaced as one, taking the
 * case of its first word; a mark the restorer put inside that stretch goes with
 * it, because nothing says which of the new words it belonged after.
 */
export function applyTranscriptCorrections(
  line: string,
  corrections: readonly TranscriptCorrection[],
): string {
  if (corrections.length === 0) return line;
  const text = line.normalize('NFC');
  const words = [...text.matchAll(WORD)];
  // Each replaced stretch of the line, keyed by its first word.
  const stretches = new Map<number, { last: number; said: string[] }>();
  const taken = new Set<number>();
  for (const correction of corrections) {
    const heard = correction.heard.split(' ');
    const said = correction.said.split(' ');
    const indices = covered(correction);
    const there = heard.every(
      (word, offset) => words[correction.at + offset]?.[0].toLowerCase() === word,
    );
    if (!there || indices.some((index) => taken.has(index))) continue;
    for (const index of indices) taken.add(index);
    if (heard.length === said.length) {
      for (const [offset, word] of said.entries()) {
        stretches.set(correction.at + offset, { last: correction.at + offset, said: [word] });
      }
    } else {
      stretches.set(correction.at, { last: correction.at + heard.length - 1, said });
    }
  }
  if (stretches.size === 0) return line;
  let result = '';
  let cursor = 0;
  for (const [index, match] of words.entries()) {
    const stretch = stretches.get(index);
    if (stretch === undefined) continue;
    const end = words[stretch.last]!;
    const [first, ...rest] = stretch.said;
    result += text.slice(cursor, match.index) + [inCaseOf(match[0], first!), ...rest].join(' ');
    cursor = end.index + end[0].length;
  }
  return result + text.slice(cursor);
}
