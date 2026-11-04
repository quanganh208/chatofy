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
 * Inserting added 6 runs of words across 148 seams, all of them right.
 */

/** How much of each turn is read around a cut. Measured against 1.5 s and 4 s. */
export const SEAM_EDGE_SECONDS = 2.5;

/** How many words a repair may add. A longer gap means the clip disagrees. */
export const MAX_INSERTED_WORDS = 6;

/** The longest edge compared against the clip, in words. */
const MAX_ANCHOR_WORDS = 5;

/** The shortest edge believed anywhere in the clip, in words. */
const MIN_ANCHOR_WORDS = 2;

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

function matchesAt(clip: Word[], at: number, edge: Word[]): boolean {
  return edge.every(
    (word, index) => clip[at + index]?.compared === word.compared,
  );
}

/**
 * Where the clip stops repeating `left`, or null when it never does.
 *
 * A side that is a single word has nothing longer to offer, and a voice change
 * can leave exactly that ("Exactly." on its own). One word proves little, so it
 * counts only as the clip's very first word, where that side's audio starts.
 */
function afterLeft(clip: Word[], left: Word[]): number | null {
  if (left.length === 1) return matchesAt(clip, 0, left) ? 1 : null;
  const longest = Math.min(MAX_ANCHOR_WORDS, left.length);
  for (let size = longest; size >= MIN_ANCHOR_WORDS; size -= 1) {
    const edge = left.slice(-size);
    for (let at = 0; at + size <= clip.length; at += 1) {
      if (matchesAt(clip, at, edge)) return at + size;
    }
  }
  return null;
}

/** Where the clip starts repeating `right` after `from`, or null. */
function beforeRight(clip: Word[], right: Word[], from: number): number | null {
  if (right.length === 1) {
    const last = clip.length - 1;
    return last >= from && matchesAt(clip, last, right) ? last : null;
  }
  const longest = Math.min(MAX_ANCHOR_WORDS, right.length);
  for (let size = longest; size >= MIN_ANCHOR_WORDS; size -= 1) {
    const edge = right.slice(0, size);
    for (let at = from; at + size <= clip.length; at += 1) {
      if (matchesAt(clip, at, edge)) return at;
    }
  }
  return null;
}

/**
 * The words `clip` heard between the end of `left` and the start of `right`,
 * spelled as the clip spelled them, or null when there is nothing to add.
 *
 * `clip` is the recognizer's reading of the audio around the cut. Null covers
 * every case that is not a clean insertion: an edge the clip does not repeat,
 * no gap between the edges, or a gap too long to be a dropped tail.
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

  const start = afterLeft(clipWords, leftWords);
  if (start === null) return null;
  const end = beforeRight(clipWords, rightWords, start);
  if (end === null) return null;

  const lost = clipWords.slice(start, end);
  if (lost.length === 0 || lost.length > MAX_INSERTED_WORDS) return null;
  return lost.map((word) => word.spelled).join(' ');
}
