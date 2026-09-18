/**
 * A backend that turns one utterance into a comparable voice vector.
 *
 * Deliberately narrow. It does not name a speaker, hold state between calls, or
 * know how many people are in the room — it answers "what does this voice look
 * like in the model's space" and stops. Everything that decides who spoke lives
 * in the client, built from vectors this returns.
 */
export interface SpeakerEmbeddingResult {
  /** Unit-norm, so two can be compared by dot product. */
  vector: number[];
  dim: number;
  /**
   * How much of the clip was speech, in ms — not how long the clip was.
   *
   * Carried because the vector alone cannot say whether it means anything. An
   * embedding computed on a moment of voice is noise, and noise resembles other
   * noise far more than it resembles a person, so a consumer clustering these
   * discovers a speaker who was never in the room. The client refuses to place a
   * turn under a floor measured in this unit.
   *
   * The clip's own length will not do: a turn arrives as a capture buffer with
   * pre-roll and hangover on it, and one measured turn held 720ms of speech
   * inside a 1540ms buffer.
   */
  speechMs: number;
}

export interface SpeakerEmbeddingProvider {
  readonly name: string;
  embed(audio: Uint8Array, mimeType: string): Promise<SpeakerEmbeddingResult>;
}
