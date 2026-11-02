import { type TranscriptCorrection, wordsOf } from './transcript-corrections.js';
import { foldForMatch } from './vietnamese.js';

/**
 * The corrections that do not contradict how the turn's own translation spelled
 * the words.
 *
 * A correction replaces words the first recognizer heard. The checks that
 * propose one read the transcript alone, but the translator read it with the
 * conversation's earlier sentences and often knows a name the second recognizer
 * did not. Heard on prod: the host of a show is "thùy minh", the second
 * recognizer heard "thì minh", the fusion took it, and the same turn's
 * translation said "Thuy Minh".
 *
 * So a correction is refused when the heard words, with a neighbouring word of
 * the turn, appear in a translation once accents are folded, and the
 * replacement in that frame does not. The neighbour is what makes this about
 * names: a translation into another language carries a Vietnamese word only
 * as part of a name, and two words folded together almost never occur in
 * English by accident, while one short word ("an", "to") would.
 */
export function keepWhatTheTranslationSpelled(
  transcript: string,
  corrections: readonly TranscriptCorrection[],
  translations: readonly string[],
): TranscriptCorrection[] {
  const spelled = translations.map(foldedWords).filter((words) => words.length > 0);
  if (corrections.length === 0 || spelled.length === 0) return [...corrections];
  const heard = wordsOf(transcript).map(foldForMatch);
  const appears = (run: readonly string[]) => spelled.some((words) => occursIn(words, run));
  return corrections.filter((correction) => {
    const from = correction.at;
    const to = from + correction.heard.split(' ').length;
    const replacement = correction.said.split(' ').map(foldForMatch);
    const frames: [string[], string[]][] = [];
    if (from > 0) frames.push([heard.slice(from - 1, to), [heard[from - 1]!, ...replacement]]);
    if (to < heard.length) frames.push([heard.slice(from, to + 1), [...replacement, heard[to]!]]);
    const spelledAsHeard = frames.some(([original]) => appears(original));
    const spelledAsSaid = frames.some(([, changed]) => appears(changed));
    return !spelledAsHeard || spelledAsSaid;
  });
}

/** A translation's words, folded, with punctuation splitting rather than joining them. */
function foldedWords(text: string): string[] {
  return foldForMatch(text.replace(/[^\p{L}\p{N}\s]/gu, ' '))
    .split(' ')
    .filter(Boolean);
}

/** Whether `run` occurs in `words` as consecutive words. */
function occursIn(words: readonly string[], run: readonly string[]): boolean {
  for (let start = 0; start + run.length <= words.length; start++) {
    if (run.every((word, offset) => words[start + offset] === word)) return true;
  }
  return false;
}
