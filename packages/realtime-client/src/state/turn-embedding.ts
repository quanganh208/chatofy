/**
 * One turn's voice vector, as it arrived off the socket.
 *
 * **A file of its own so that deleting a module is a decision rather than a
 * refactor.** These two types were declared in `speaker-centroids.ts`, the
 * enrolment path the reducer no longer runs. `turn-keyed-transcript.ts` imported
 * them from there, which quietly made a retired module load-bearing: the enrolment
 * code was dead by every reading of the call graph and still could not be removed
 * without breaking the live path. Whoever finally deletes it should be weighing
 * whether enrolment is still worth keeping, not discovering a type it owns.
 *
 * Both consumers are here for the same reason and neither is the owner:
 * `turn-keyed-transcript.ts` holds the vectors for the conversation, and
 * `speaker-centroids.ts` averages the confirmed ones into a profile.
 */

/** One turn's voice vector, and how much audio produced it. */
export interface TurnEmbedding {
  /** Unit-norm, so a dot product is a cosine. Normalised by the sidecar. */
  vector: number[];
  /** How much audio it was built from, for weighting. */
  audioMs: number;
  /**
   * How much of that audio was speech, for deciding whether to believe it.
   *
   * Kept beside `audioMs` rather than replacing it because they answer
   * different questions and only one of them is a weight: `audioMs` is the
   * capture buffer, pre-roll and hangover included, and this is the voice inside
   * it. A vector built on too little speech carries no speaker information at
   * all — see `SPEECH_FLOOR_MS` in `auto-attribution.ts`, which is the one
   * consumer.
   */
  speechMs: number;
}

/** Every vector this conversation has received, keyed by turn. */
export type EmbeddingsBySession = Record<string, TurnEmbedding>;
