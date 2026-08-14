/**
 * Keeps the join between two spoken clauses from sounding like a full stop.
 *
 * A clause committed mid-sentence is translated on its own, and the model
 * finishes it the way it finishes any sentence: with a period. The next clause
 * then starts in lower case and the listener hears one sentence end and another
 * begin, in the middle of what the speaker said as a single breath.
 *
 * It matters more here than on screen because synthesis takes its intonation
 * from punctuation (see `clause-splitter`): a period tells the engine to close
 * the phrase and drop the pitch, so the seam is audible even when the words are
 * right.
 *
 * The rule is one-directional on purpose. Terminal punctuation is only ever
 * SOFTENED, never added or strengthened — the source is what decides whether the
 * speaker finished a sentence, and a translation is not allowed to overrule it.
 */

/** Marks that end a sentence: the speaker is done with the thought. */
const SENTENCE_END = /[.!?…]+$/;

/** Marks that continue a sentence: more is coming. */
const CLAUSE_CONTINUES = /[,;:]$/;

/**
 * Match a translated clause's ending to what the source clause actually did.
 *
 * `sourceClause` is the recognised speech this translation came from, so its
 * final mark is the one piece of evidence about whether the speaker stopped.
 *
 * Returns the translation unchanged whenever the source ended a sentence, or
 * ended with nothing at all — a clause cut at the word-count limit has no mark
 * to copy, and inventing one would be a guess spoken aloud.
 */
export function matchClauseEnding(
  translated: string,
  sourceClause: string,
): string {
  const target = translated.trim();
  const source = sourceClause.trim();
  if (!target) return target;

  // The speaker did finish a sentence: whatever the translation chose is right.
  if (SENTENCE_END.test(source)) return target;

  const continuation = CLAUSE_CONTINUES.exec(source)?.[0];
  if (!continuation) {
    // No mark in the source — a forced cut mid-phrase. Drop a sentence ending
    // the model added rather than replacing it, so the engine does not close a
    // phrase the speaker left open.
    return target.replace(SENTENCE_END, '');
  }

  // The source continued, so the translation must continue too, with the same
  // mark the speaker used.
  return SENTENCE_END.test(target)
    ? target.replace(SENTENCE_END, continuation)
    : CLAUSE_CONTINUES.test(target)
      ? target
      : `${target}${continuation}`;
}
