import type { AttributionsBySession, SessionSpeaker } from './speaker-roster.js';
import type { EmbeddingsBySession } from './turn-embedding.js';

/**
 * Guessing who spoke, from voices the conversation has already been told about.
 *
 * **This only ever suggests.** It cannot name somebody nobody added, cannot add
 * anybody, and cannot overrule a person — the reducer decides what to do with
 * what this returns, and a confirmed attribution always wins. The measurements
 * behind the feature are the reason: on two seconds of far-field Vietnamese
 * these embeddings are reliable only when everybody speaking has already been
 * heard from, and nothing in the audio can tell when that stops being true. A
 * layer that could decide would be wrong confidently, which is worse than a
 * layer that is sometimes silent.
 *
 * **Only confirmed turns build a profile.** A suggestion that seeded the profile
 * that produced the next suggestion would make one early mistake permanent and
 * self-reinforcing — the model would keep agreeing with itself. That rule is
 * enforced here, in {@link buildCentroids}, and again by the reducer refusing to
 * write a suggestion over a confirmation.
 *
 * **Everything stays in this tab.** Vectors arrive over the socket, are held for
 * the conversation, and go with it. Nothing is stored and nothing is sent back.
 */

/**
 * How close a voice must be to a profile before it is worth saying anything.
 *
 * From the calibration run: the value at which attribution reached 87% accuracy
 * over the most confident 80% of turns with five speakers on two-second
 * far-field audio.
 *
 * **Calibrated on a channel this product does not use.** Every clip behind this
 * number reached the model without passing through the browser's noise
 * suppression or automatic gain control, both of which reshape exactly the
 * timbre an embedding reads. That is why the feature ships switched off: the
 * number is the best available and is not yet the right one.
 *
 * The calibration also produced a second, lower threshold, below which it would
 * mint a new speaker. It has no counterpart here — minting is something a person
 * does, from the chip — so everything under this one threshold means the same
 * thing: say nothing. Carrying the second value anyway would be a constant that
 * looks like it decides something.
 */
export const TAU_SUGGEST = 0.35;

/** The average voice of each speaker somebody has confirmed. */
export function buildCentroids(
  speakers: readonly SessionSpeaker[],
  attributions: AttributionsBySession,
  embeddings: EmbeddingsBySession,
): Map<string, Float64Array> {
  const sums = new Map<string, { sum: Float64Array; weight: number }>();

  for (const [sessionId, attribution] of Object.entries(attributions)) {
    // The rule the whole design rests on. Read it here rather than trusting a
    // caller to filter: this is the only place a profile is built.
    if (attribution.origin !== 'confirmed' || !attribution.speakerId) continue;
    if (!speakers.some((speaker) => speaker.id === attribution.speakerId)) continue;

    const embedding = embeddings[sessionId];
    if (!embedding) continue;

    // Weighted by duration, matching the calibration. A half-second turn and a
    // five-second one are not equally good evidence of what somebody sounds
    // like, and averaging them flat quietly makes the short ones louder.
    const weight = Math.max(embedding.audioMs, 1);
    const existing = sums.get(attribution.speakerId);
    if (!existing) {
      const sum = new Float64Array(embedding.vector.length);
      for (let index = 0; index < embedding.vector.length; index += 1) {
        sum[index] = embedding.vector[index]! * weight;
      }
      sums.set(attribution.speakerId, { sum, weight });
      continue;
    }
    if (existing.sum.length !== embedding.vector.length) continue;
    for (let index = 0; index < embedding.vector.length; index += 1) {
      existing.sum[index] = existing.sum[index]! + embedding.vector[index]! * weight;
    }
    existing.weight += weight;
  }

  const centroids = new Map<string, Float64Array>();
  for (const [speakerId, { sum }] of sums) {
    let norm = 0;
    for (const value of sum) norm += value * value;
    norm = Math.sqrt(norm);
    if (norm === 0) continue;
    const centroid = new Float64Array(sum.length);
    for (let index = 0; index < sum.length; index += 1) centroid[index] = sum[index]! / norm;
    centroids.set(speakerId, centroid);
  }
  return centroids;
}

/**
 * The speaker this voice is closest to, if it is close enough to any of them.
 *
 * `null` covers three cases that all mean the same thing to a reader — nobody
 * has been confirmed yet, the voice matches nobody well, or it matches somebody
 * badly. All three should produce no label rather than a hesitant one; a chip
 * reading a name it is unsure of is a chip somebody has to check, and the whole
 * premise of the design is that in a live conversation nobody is checking.
 */
export function suggestSpeaker(
  centroids: Map<string, Float64Array>,
  vector: readonly number[],
  tau = TAU_SUGGEST,
): { speakerId: string; score: number } | null {
  let best: { speakerId: string; score: number } | null = null;

  for (const [speakerId, centroid] of centroids) {
    if (centroid.length !== vector.length) continue;
    let score = 0;
    for (let index = 0; index < centroid.length; index += 1) {
      score += centroid[index]! * vector[index]!;
    }
    if (!best || score > best.score) best = { speakerId, score };
  }

  return best && best.score >= tau ? best : null;
}
