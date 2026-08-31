import { MINUTES_LIMITS, type MinutesSourceTurn } from '@chatofy/types';

/**
 * Split the finished turns into chunks each small enough for one summarize pass.
 *
 * The service owns the turn array, and this is the only place that can chunk it
 * correctly: a turn's `text` may itself contain newlines, so the already-joined
 * `Label: text` transcript string cannot be re-split on `\n` without tearing a
 * turn — and a torn turn corrupts speaker attribution and the injection boundary
 * the transcript is wrapped in. So the split happens on the array, on TURN
 * boundaries, never inside one.
 *
 * Greedy: turns pack into the current chunk until the next would push its
 * assembled transcript over `maxChars`, then a new chunk starts. The budget is
 * measured on the line each turn becomes (`Label: text\n`), so a chunk's built
 * transcript stays under the same budget a single-pass request is held to. A
 * lone turn larger than the budget still becomes its own one-turn chunk rather
 * than being split — the per-turn cap keeps that far below the budget in
 * practice, but never splitting a turn is the invariant that matters.
 */
export function chunkTurns(
  turns: readonly MinutesSourceTurn[],
  maxChars: number = MINUTES_LIMITS.MINUTES_CHUNK_CHARS,
): MinutesSourceTurn[][] {
  const chunks: MinutesSourceTurn[][] = [];
  let current: MinutesSourceTurn[] = [];
  let currentChars = 0;

  for (const turn of turns) {
    // `${speakerLabel}: ${text}` plus the joining newline — what this turn adds
    // to the transcript the model actually sees.
    const lineChars = turn.speakerLabel.length + 2 + turn.text.length + 1;
    if (current.length > 0 && currentChars + lineChars > maxChars) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(turn);
    currentChars += lineChars;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
