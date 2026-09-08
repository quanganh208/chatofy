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
}

/** Every vector this conversation has received, keyed by turn. */
export type EmbeddingsBySession = Record<string, TurnEmbedding>;
