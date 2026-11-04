import { wordsOf } from '@chatofy/types';

/**
 * Words a ceiling cut lost between two turns, recovered from a second reading.
 *
 * The recognizer can drop the last words of a turn that ends mid-sentence:
 * "Exactly, and this is | crucial because" came back "Exactly." and "crucial
 * because". Decoding the audio around the cut as one short clip hears them.
 *
 * That clip is trusted for one thing only: the words it heard BETWEEN the two
 * turns' own edges. It never replaces a word either turn kept. Replacing was
 * measured and rejected: it fixed more English errors, but it took Vietnamese
 * from 5.98% to 6.89% WER by deleting a phrase the clip decoded differently.
 * The clip also has to agree with both turns up to its own outer edges, so a
 * clip that reads a turn differently adds nothing.
 */

/** How much of each turn is read around a cut. Measured against 1.5 s and 4 s. */
export const SEAM_EDGE_SECONDS = 2.5;

/** How many words a repair may add. A longer gap means the clip disagrees. */
export const MAX_INSERTED_WORDS = 6;

/**
 * The fewest words a side must agree on, or all of them for a shorter side.
 * Two is not enough: "of the" fits a later "of the" with one word to forgive.
 */
const MIN_AGREEING_WORDS = 3;

/**
 * Words at each end of the clip that may disagree with the turn. The clip is
 * cut mid-speech there, so its outermost word is often a fragment.
 */
const OUTER_WORDS = 1;

interface Word {
  spelled: string;
  /** Empty for a token with no letters or digits, which is then ignored. */
  compared: string;
}

function wordsIn(text: string): Word[] {
  return text
    .split(/\s+/)
    .map((spelled) => ({ spelled, compared: wordsOf(spelled) }))
    .filter((word) => word.compared);
}

/**
 * Whether the clip, read backwards from `at`, is the end of `left`.
 *
 * It has to agree all the way to the clip's outer edge, not just on a word or
 * two: a two-word match alone also fits a common phrase said seconds earlier,
 * and a clip that reads the turn differently is one this repair must not trust.
 *
 * A side that is a single word has nothing longer to offer, and a voice change
 * can leave exactly that ("Exactly." on its own). One word proves little, so it
 * counts only as the clip's very first word, where that side's audio starts.
 */
function endsLeft(clip: Word[], left: Word[], at: number): boolean {
  if (left.length === 1) {
    return at === 1 && clip[0]?.compared === left[0]?.compared;
  }
  let agreed = 0;
  while (
    agreed < at &&
    agreed < left.length &&
    clip[at - 1 - agreed]?.compared === left[left.length - 1 - agreed]?.compared
  ) {
    agreed += 1;
  }
  return (
    agreed >= Math.min(MIN_AGREEING_WORDS, left.length) &&
    at - agreed <= OUTER_WORDS
  );
}

/** Whether the clip, read forwards from `at`, is the start of `right`. */
function startsRight(clip: Word[], right: Word[], at: number): boolean {
  if (right.length === 1) {
    return at === clip.length - 1 && clip[at]?.compared === right[0]?.compared;
  }
  let agreed = 0;
  while (
    at + agreed < clip.length &&
    agreed < right.length &&
    clip[at + agreed]?.compared === right[agreed]?.compared
  ) {
    agreed += 1;
  }
  return (
    agreed >= Math.min(MIN_AGREEING_WORDS, right.length) &&
    clip.length - at - agreed <= OUTER_WORDS
  );
}

/** Each pair of neighbouring words, as one string. */
function pairsIn(words: Word[]): string[] {
  return words
    .slice(1)
    .map((word, index) => `${words[index]!.compared} ${word.compared}`);
}

/**
 * Whether a gap only says again what a turn kept, which is a clip misreading
 * the turn rather than a word the turn lost.
 */
function repeatsTurn(lost: Word[], left: Word[], right: Word[]): boolean {
  const kept = new Set([...pairsIn(left), ...pairsIn(right)]);
  return (
    pairsIn(lost).some((pair) => kept.has(pair)) ||
    lost[0]?.compared === left[left.length - 1]?.compared ||
    lost[lost.length - 1]?.compared === right[0]?.compared
  );
}

/**
 * The words `clip` heard between the end of `left` and the start of `right`,
 * spelled as the clip spelled them, or null when there is nothing to add.
 *
 * `clip` is the recognizer's reading of the audio around the cut. Null covers
 * every case that is not one clean insertion: a clip that disagrees with a
 * side, that reads both sides with no gap, that fits two different gaps, or
 * whose gap is too long or repeats a turn.
 */
export function wordsLostAtSeam(
  left: string,
  right: string,
  clip: string,
): string | null {
  const leftWords = wordsIn(left);
  const rightWords = wordsIn(right);
  const clipWords = wordsIn(clip);
  if (!leftWords.length || !rightWords.length) return null;

  let gap: Word[] | null = null;
  for (let start = 0; start <= clipWords.length; start += 1) {
    if (!endsLeft(clipWords, leftWords, start)) continue;
    const last = Math.min(start + MAX_INSERTED_WORDS, clipWords.length);
    for (let end = start; end <= last; end += 1) {
      if (!startsRight(clipWords, rightWords, end)) continue;
      if (end === start || gap) return null;
      gap = clipWords.slice(start, end);
    }
  }
  if (!gap || repeatsTurn(gap, leftWords, rightWords)) return null;
  return gap.map((word) => word.spelled).join(' ');
}
