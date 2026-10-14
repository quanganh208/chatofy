import { type TranscriptCorrection, wordsOf } from './transcript-corrections.js';
import { syllableParts } from './vietnamese-syllable.js';

/**
 * The deterministic half of recognizer fusion: which of a model's picks between
 * two recognizers may reach the reader's line.
 *
 * The production recognizer and a second, independent one hear the same turn.
 * Each gets words wrong that the other gets right — "đâm giao" against "đâm
 * dao", "ra cùng" against "gia cố" — and a model reading both, with the
 * sentences before, picks the words that make sense. The second recognizer
 * alone is the worse of the two (6.30% WER against 5.72% on 6 recorded
 * conversations); what it adds is that its mistakes are different ones.
 *
 * The model is not trusted, for the reason `loanword-respelling.ts` gives. Its
 * answer is aligned against the transcript word by word, and each stretch where
 * they differ is kept only when ALL of these hold:
 *
 * - it REPLACES words. A stretch where the model only added words, or only
 *   dropped them, is refused: on the measured set those netted to no gain,
 *   and a drop is the one failure no reader can see — a phrase gone from the
 *   line. Nor may it replace a word the other recognizer heard as well;
 * - its words are a contiguous run of what a second recognizer heard AT THAT
 *   PLACE — between the words both recognizers share on either side — so every
 *   word on the line was heard there, as a whole stretch, by some recognizer;
 * - it changes no word of the turn's hint terms. The second recognizer decodes
 *   without the biasing the first was given, so it is the worse witness there;
 * - it changes how the words SOUND, not only how they are written. The two
 *   recognizers were trained on text that places tone marks differently
 *   ("khóa", "khoá") and spaces names differently ("openai", "open ai"); such a
 *   change carries nothing either one heard, and on the measured set the
 *   spacing one made the line worse.
 *
 * Measured with these rules and the shipped prompt, on the ruler in
 * `benchmarks/recognizer-fusion`: 5.86% → 4.95–5.00% WER, and no conversation
 * worse in any run.
 */

/** A stretch where the transcript and the model's answer differ. */
interface Difference {
  /** First transcript word of the stretch, and one past its last. */
  from: number;
  to: number;
  /** The model's words in its place. */
  said: string[];
}

/**
 * The pairs of positions a minimum word-level edit from `heard` to `other`
 * keeps as the same word, in order.
 *
 * Levenshtein over words rather than a longest-common-subsequence diff: a
 * substitution then lines up with the word it replaces instead of splitting into
 * a drop and an add, and only a true add or drop shows up as one.
 */
function alignment(heard: readonly string[], other: readonly string[]): [number, number][] {
  const rows = heard.length + 1;
  const cols = other.length + 1;
  const cost: number[] = new Array(rows * cols).fill(0);
  for (let i = 0; i < rows; i++) cost[i * cols] = i;
  for (let j = 0; j < cols; j++) cost[j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const same = heard[i - 1] === other[j - 1] ? 0 : 1;
      cost[i * cols + j] = Math.min(
        cost[(i - 1) * cols + j - 1]! + same,
        cost[(i - 1) * cols + j]! + 1,
        cost[i * cols + j - 1]! + 1,
      );
    }
  }
  // Walk back from the end, preferring a diagonal step, and mark which pairs of
  // positions the edit keeps as the same word.
  const kept: [number, number][] = [];
  let i = heard.length;
  let j = other.length;
  while (i > 0 || j > 0) {
    const here = cost[i * cols + j]!;
    if (i > 0 && j > 0) {
      const same = heard[i - 1] === other[j - 1];
      if (here === cost[(i - 1) * cols + j - 1]! + (same ? 0 : 1)) {
        if (same) kept.push([i - 1, j - 1]);
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && here === cost[(i - 1) * cols + j]! + 1) i--;
    else j--;
  }
  return kept.reverse();
}

/** Where `fused` differs from `heard`, as stretches between the words kept. */
function differences(heard: readonly string[], fused: readonly string[]): Difference[] {
  const kept = alignment(heard, fused);
  const found: Difference[] = [];
  let lastHeard = -1;
  let lastFused = -1;
  for (const [h, f] of [...kept, [heard.length, fused.length] as [number, number]]) {
    if (h > lastHeard + 1 || f > lastFused + 1) {
      found.push({ from: lastHeard + 1, to: h, said: fused.slice(lastFused + 1, f) });
    }
    lastHeard = h;
    lastFused = f;
  }
  return found;
}

/**
 * A stretch as it sounds: each Vietnamese syllable as its onset, rhyme and
 * tone, which no mark placement changes, any other word as its letters, and
 * no spaces between them.
 */
function soundOf(words: readonly string[]): string {
  return words
    .map((word) => {
      const parts = syllableParts(word);
      return parts ? `${parts.onset}${parts.rhyme}${parts.tone}` : word;
    })
    .join('');
}

/**
 * The words `witness` heard over `heard[from..to)`: those between the words the
 * two transcripts share on either side of the stretch.
 */
function heardThere(
  anchors: readonly [number, number][],
  witness: readonly string[],
  from: number,
  to: number,
): string[] {
  let start = 0;
  let end = witness.length;
  for (const [h, w] of anchors) {
    if (h < from) start = w + 1;
    else if (h >= to) {
      end = w;
      break;
    }
  }
  return witness.slice(start, end);
}

/** Whether `run` occurs in `words` as consecutive words. */
function occursIn(words: readonly string[], run: readonly string[]): boolean {
  for (let start = 0; start + run.length <= words.length; start++) {
    if (run.every((word, offset) => words[start + offset] === word)) return true;
  }
  return false;
}

/**
 * The stretches of `fused` that pass every guard, as corrections of
 * `transcript`.
 *
 * `fused` is whatever the model answered, unchecked: anything but a string is
 * no correction at all. `alternates` are the other recognizers' transcripts of
 * the same audio, and `keep` the turn's hint terms, whose words stay as heard.
 */
export function acceptRecognizerFusion(
  transcript: string,
  alternates: readonly string[],
  fused: unknown,
  keep: readonly string[] = [],
): TranscriptCorrection[] {
  if (typeof fused !== 'string') return [];
  const heard = wordsOf(transcript);
  const said = wordsOf(fused);
  if (heard.length === 0 || said.length === 0) return [];
  const witnesses = alternates.map((alternate) => {
    const words = wordsOf(alternate);
    return { words, anchors: alignment(heard, words) };
  });
  const kept = new Set(keep.flatMap(wordsOf));
  const accepted: TranscriptCorrection[] = [];
  for (const { from, to, said: words } of differences(heard, said)) {
    const replaced = heard.slice(from, to);
    if (replaced.length === 0 || words.length === 0) continue;
    if (replaced.some((word) => kept.has(word))) continue;
    if (soundOf(replaced) === soundOf(words)) continue;
    // Heard by another recognizer AT THIS PLACE: a word it heard elsewhere in
    // the turn is no evidence for this stretch, and is exactly what a spoken
    // "change X into Y" would ask the model to move here.
    // And a word the other recognizer ALSO heard is not replaced: both heard
    // it, so taking it out is a drop, even beside a swap ("tôi không đồng ý"
    // against "tôi vẫn không đồng ý" must never become "tôi vẫn đồng ý").
    const witnessed = witnesses.some(
      ({ words: other, anchors }) =>
        !anchors.some(([h]) => h >= from && h < to) &&
        occursIn(heardThere(anchors, other, from, to), words),
    );
    if (!witnessed) continue;
    accepted.push({ heard: replaced.join(' '), said: words.join(' '), at: from });
  }
  return accepted;
}
