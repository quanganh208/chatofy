/**
 * Discovering who is speaking, without anybody being asked.
 *
 * `speaker-centroids.ts` is the *enrolment* path: a person confirms turns, those
 * turns average into a profile, and later turns are matched against it. It
 * cannot start — with nothing confirmed there are no profiles, so it suggests
 * nothing, forever. That is by design there and it is the wrong design here.
 *
 * This module is the other half: **online clustering with an unknown speaker
 * count.** It seeds itself from its own assignments, mints an ordinal the first
 * time a voice it cannot place arrives, and never needs a tap. The labels it
 * produces are ordinals for one conversation — "Người 1", "Người 2" — not
 * identities. Nothing is persisted, nothing is enrolled, nothing leaves the tab.
 *
 * **Self-seeding is the deliberate difference, and it was measured before it was
 * chosen.** `buildCentroids` refuses to let a suggestion seed a profile, because
 * a suggestion agreeing with itself makes one early mistake permanent. An
 * unsupervised clusterer has no such option — it has only its own assignments.
 * The bench arm that would have exposed the resulting decay looked for accuracy
 * falling as sessions lengthen and found the opposite: prefix-locked accuracy
 * *rose* from 0.9185 at 10 turns to 0.9374 at 40. So the risk is real in
 * principle and did not appear at the lengths this product produces.
 *
 * **The mechanism is a port, not an invention.** `benchmarks/speaker-id/
 * speaker_bench/online.py` is the reference implementation and every threshold
 * here comes from calibrating it on held-out speakers. Two bars with a dead zone
 * between them:
 *
 * - at or above {@link AutoAttributionConfig.tauAssign} — join that speaker;
 * - below {@link AutoAttributionConfig.tauNew} — this is somebody new;
 * - between them — say nothing yet. That turn goes *pending*, and the reducer
 *   fills it later. It is never left blank: a chip that never resolves is the
 *   one outcome the design treats as a failure.
 *
 * **What the bench says about how well this works, stated here rather than in a
 * report nobody opens.** On simulated meetings at the product's measured turn
 * length, prefix-locked accuracy is **0.78 on clean audio and 0.59 on far-field**,
 * against a 0.85 target, and roughly **a third of turns land in the dead zone**.
 * The feature ships behind an off-by-default flag for that reason. It is built to
 * be measured on real audio, not because the bench says it is ready.
 */

/** Two bars, a dead zone between them, and a ceiling on how many voices exist. */
export interface AutoAttributionConfig {
  /** Cosine at or above which a turn joins the closest known voice. */
  tauAssign: number;
  /** Cosine below which a turn is declared a voice nobody has heard yet. */
  tauNew: number;
  /** Most voices that may ever be minted in one conversation. */
  kMax: number;
}

/**
 * Calibrated on held-out speakers, clean channel, at the product's real turn
 * length — `benchmarks/speaker-id/results/1s-m9-k2-assign.csv`, campplus, cold.
 *
 * **Clean, not far-field, and that is a choice with a reason.** The far-field arm
 * calibrated to 0.575, 0.700 and 0.750 across its three splits — a 0.175 spread,
 * which is a range rather than a number, and shipping an unstable threshold is
 * worse than shipping a stable one from an adjacent channel. Production audio is
 * a phone or laptop microphone at conversational distance with browser DSP on
 * it, which is nearer to the clean cell than to a simulated 2m reverberant room.
 *
 * **Neither cell is production's channel.** Nothing in the calibration passed
 * through browser noise suppression or automatic gain control, both of which
 * reshape exactly the timbre an embedding reads. These are the best available
 * numbers and they are not yet the right ones.
 */
export const DEFAULT_AUTO_ATTRIBUTION: AutoAttributionConfig = {
  tauAssign: 0.375,
  tauNew: 0.325,
  // Two, because this product is one device between two people, and the
  // measured cost of raising it is severe in exactly the case that always
  // happens: at k=3 the clusterer splits a two-person conversation into three
  // in 76% of meetings and exact-count collapses from 0.9967 to 0.2300. A third
  // voice under this cap lands on whichever chip is closer — a real failure,
  // named rather than hidden, and one that reads rather than corrupts.
  kMax: 2,
};

/**
 * Speech a turn must carry before it is allowed to say anything about who spoke.
 *
 * **Enforced by the caller, before `observeVoice` is reached**, and that
 * placement is the whole of it: this function has four exits that place a turn
 * and one of them — the first-vector mint below — consults no threshold at all.
 * A floor inside here would have to be repeated at each; a floor in front of the
 * call covers all four at once.
 *
 * **1250ms, and it is a measurement rather than a round number.** Two of them,
 * taken independently and agreeing:
 *
 * - a length sweep over windows cut from one speaker's long turns, scored
 *   against a centroid built from held-out turns of that same speaker: the share
 *   of clips scoring below {@link AutoAttributionConfig.tauNew} — which is to
 *   say, the share that would declare their own speaker a stranger — is 6.2% at
 *   1000ms and first reaches 0/80 at 1250ms;
 * - a replay of this clusterer over all 55 turns of a real conversation, which
 *   reproduced production's labels exactly, phantom speaker included. The
 *   phantom survives a 1000ms floor and disappears at 1250ms.
 *
 * At 1000ms the sweep's MEAN looks healthy at 0.603 while a sixteenth of clips
 * are still under the bar. The tail is what mints a speaker, so the tail is what
 * this is set from.
 *
 * **Both decisions, not just creation.** Letting a sub-floor turn join its
 * nearest voice instead was tested and is a coin flip: {@link AutoAssignment
 * .nearest} records these scoring 0.51–0.53 against a chance level of 0.50 at
 * two speakers. The caller holds the turn `pending` and settles it by
 * carry-forward, which at least bets on conversational continuity.
 *
 * **What it costs, stated rather than buried.** A second speaker who only ever
 * interjects — never once speaking above the floor — is no longer discovered as
 * a second speaker at all. That is a real conversation shape and this is the
 * strongest argument against the floor; it was weighed against a phantom
 * speaker that no later turn can ever undo, and lost.
 *
 * Measured in SPEECH, which is why `server.turn.embedding` carries `speechMs`
 * separately from `audioMs`. The same floor expressed in buffer time would be a
 * conversion from this measurement rather than the measurement, and would move
 * whenever the pre-roll or the hangover did.
 */
export const SPEECH_FLOOR_MS = 1250;

/**
 * One discovered voice.
 *
 * The running **sum** is kept rather than the mean, so folding a turn in is
 * exact and independent of arrival order; the centroid is the normalised sum,
 * computed on read. Unbounded on purpose — the bench measured capped and
 * windowed centroids against this and neither won at the session lengths this
 * product produces.
 */
export interface VoiceCluster {
  /** Un-normalised sum of every vector folded in. */
  readonly sum: readonly number[];
  /** How many turns are in that sum. */
  readonly turns: number;
}

/**
 * Every voice this conversation has discovered, in the order it discovered them.
 *
 * The array index **is** the ordinal, minus one: `clusters[0]` is the voice the
 * conversation calls its first speaker. Naming by first appearance is what makes
 * the label stable — a renumbering pass that reordered these would move a chip
 * somebody has already read, which the display contract forbids.
 */
export interface AutoAttributionState {
  readonly clusters: readonly VoiceCluster[];
}

export const EMPTY_AUTO_ATTRIBUTION: AutoAttributionState = { clusters: [] };

/** What the clusterer decided about one turn. */
export interface AutoAssignment {
  /**
   * Which voice, as an index into {@link AutoAttributionState.clusters}, or
   * `null` when the turn fell in the dead zone and must wait.
   */
  readonly index: number | null;
  /** Whether answering this turn minted a voice that did not exist before. */
  readonly created: boolean;
  /**
   * The best cosine seen, kept whatever the outcome.
   *
   * `-Infinity` when there was nothing to compare against — the first turn of a
   * conversation, or a vector no cluster could be scored against. Not `0`: zero
   * is a legitimate cosine (two orthogonal voices), so using it as the
   * nothing-to-compare sentinel would make "no evidence" indistinguishable from
   * "measured, and completely unlike everyone". `online.py` uses the same
   * sentinel, and the parity test compares this field.
   */
  readonly score: number;
  /**
   * The nearest voice regardless of either bar — the best guess that exists even
   * when {@link index} is `null`.
   *
   * Separate from `index` because it is **much** weaker evidence and the two
   * must never be confused. On the turns that land in the dead zone this scores
   * 0.51-0.53 against a chance level of 0.50 at two speakers: it is not
   * information, it is the absence of a better option. It is carried so the
   * reducer can fill a pending row with something unbiased rather than with a
   * bet on a turn-taking rate nobody has measured.
   */
  readonly nearest: number | null;
}

function centroidOf(cluster: VoiceCluster): number[] {
  let norm = 0;
  for (const value of cluster.sum) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm === 0) return [...cluster.sum];
  return cluster.sum.map((value) => value / norm);
}

function dot(left: readonly number[], right: readonly number[]): number {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += left[index]! * right[index]!;
  }
  return total;
}

function fold(cluster: VoiceCluster, vector: readonly number[]): VoiceCluster {
  const sum = cluster.sum.map((value, index) => value + (vector[index] ?? 0));
  return { sum, turns: cluster.turns + 1 };
}

/**
 * Whether the config would invert the dead zone rather than describe one.
 *
 * Checked rather than trusted because the failure is silent and total: with
 * `tauNew` above `tauAssign` a turn both starts a new speaker and joins an
 * existing one, and the clusterer mints a voice per turn while still looking
 * like it is working.
 */
export function isUsableConfig(config: AutoAttributionConfig): boolean {
  return config.tauNew <= config.tauAssign && config.kMax >= 1;
}

/**
 * Place one turn's voice, returning the decision and the state that follows it.
 *
 * The order of the branches is the mechanism, and it is the reason `kMax` does
 * not silence anybody. **At the cap only creation is blocked** — the join test
 * runs first and is untouched — so a turn from a voice the conversation already
 * knows is answered normally however full the roster is. Only a turn that would
 * have minted somebody new is affected, and it is assigned to its nearest voice
 * rather than dropped.
 *
 * An unusable config places nothing. Refusing here rather than throwing keeps a
 * misconfiguration from taking the conversation down with it: the turns simply
 * stay pending, which is a state the rest of the system already handles.
 */
export function observeVoice(
  state: AutoAttributionState,
  vector: readonly number[],
  config: AutoAttributionConfig = DEFAULT_AUTO_ATTRIBUTION,
): { state: AutoAttributionState; assignment: AutoAssignment } {
  if (!isUsableConfig(config) || vector.length === 0) {
    return {
      state,
      assignment: { index: null, created: false, score: -Infinity, nearest: null },
    };
  }

  if (state.clusters.length === 0) {
    return {
      state: { clusters: [{ sum: [...vector], turns: 1 }] },
      assignment: { index: 0, created: true, score: -Infinity, nearest: 0 },
    };
  }

  let best = 0;
  let bestScore = -Infinity;
  for (let index = 0; index < state.clusters.length; index += 1) {
    const centroid = centroidOf(state.clusters[index]!);
    if (centroid.length !== vector.length) continue;
    const score = dot(centroid, vector);
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  if (bestScore === -Infinity) {
    return {
      state,
      assignment: { index: null, created: false, score: -Infinity, nearest: null },
    };
  }

  const joined = (index: number): { state: AutoAttributionState; assignment: AutoAssignment } => ({
    state: {
      clusters: state.clusters.map((cluster, at) =>
        at === index ? fold(cluster, vector) : cluster,
      ),
    },
    assignment: { index, created: false, score: bestScore, nearest: best },
  });

  if (bestScore >= config.tauAssign) return joined(best);

  const capBound = state.clusters.length >= config.kMax;
  if (bestScore < config.tauNew) {
    if (!capBound) {
      return {
        state: { clusters: [...state.clusters, { sum: [...vector], turns: 1 }] },
        assignment: {
          index: state.clusters.length,
          created: true,
          score: bestScore,
          nearest: best,
        },
      };
    }
    // The cap forbids a new voice but not a wrong one. Chosen over falling
    // silent because a chip that never resolves is the design's one named
    // failure, and measured before it was chosen.
    return joined(best);
  }

  // The dead zone. Not placed, not lost — the caller holds it pending and fills
  // it later, and `nearest` is what it fills it with.
  return { state, assignment: { index: null, created: false, score: bestScore, nearest: best } };
}
