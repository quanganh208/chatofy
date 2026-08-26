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
}

export interface SpeakerEmbeddingProvider {
  readonly name: string;
  embed(audio: Uint8Array, mimeType: string): Promise<SpeakerEmbeddingResult>;
}
