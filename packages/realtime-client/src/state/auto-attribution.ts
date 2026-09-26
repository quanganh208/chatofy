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
 * **A new voice is not believed on one turn.** A turn that would mint somebody
 * opens a *provisional* voice instead, which names nobody; the second turn that
 * matches it is what makes it a speaker (`mintConfirmations`). The first vector
 * of a conversation is no exception. One odd turn — a filler, a cough, a burst
 * of noise — used to become a permanent ordinal, and the ordinal it took decided
 * who everybody else was called. At session end a provisional voice that never
 * found its second turn is promoted if the cap has room: its turns never showed
 * a name, so promoting it renumbers nothing anybody saw.
 *
 * **What the bench says about how well this works, stated here rather than in a
 * report nobody opens.** On 100 real two-person Vietnamese dialogues (ViYT-Diar,
 * held-out half), run through this whole client pipeline, all-turn accuracy is
 * **0.84 clean and 0.80 far-field** with the right speaker count in about 0.9 of
 * sessions — against 0.79 / 0.77, and about 0.7, for the single-turn mint behind a
 * 1250ms speech floor that shipped before it. On eight production recordings it
 * is 0.89 against 0.86. One failure it does not fix, measured on the browser
 * channel: two voices whose turns score above `tauAssign` against each other are
 * merged into one speaker. See
 * `plans/260926-1444-viyt-diar-attribution-ruler/adaptive-threshold-findings.md`.
 */

/** Two bars, a dead zone between them, and a ceiling on how many voices exist. */
export interface AutoAttributionConfig {
  /** Cosine at or above which a turn joins the closest known voice. */
  tauAssign: number;
  /** Cosine below which a turn is declared a voice nobody has heard yet. */
  tauNew: number;
  /** Most voices that may ever be minted in one conversation. */
  kMax: number;
  /**
   * Turns that must agree before a new voice becomes a speaker. 1 mints on the
   * first turn, which is what `online.py` calls `mint_confirmations == 1`.
   */
  mintConfirmations: number;
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
  // Measured against 1 on real dialogue: see the module header. 3 was no better
  // and delays every new voice by one more turn.
  mintConfirmations: 2,
};

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
  /**
   * Voices heard once but not yet corroborated, in the order they were opened.
   * They carry no ordinal and render nothing; see `mintConfirmations`.
   */
  readonly provisional: readonly VoiceCluster[];
}

export const EMPTY_AUTO_ATTRIBUTION: AutoAttributionState = { clusters: [], provisional: [] };

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
  return config.tauNew <= config.tauAssign && config.kMax >= 1 && config.mintConfirmations >= 1;
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

  if (state.clusters.length === 0) return open(state, vector, config, -Infinity, null);

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
      ...state,
      clusters: state.clusters.map((cluster, at) =>
        at === index ? fold(cluster, vector) : cluster,
      ),
    },
    assignment: { index, created: false, score: bestScore, nearest: best },
  });

  if (bestScore >= config.tauAssign) return joined(best);

  const capBound = state.clusters.length >= config.kMax;
  if (bestScore < config.tauNew) {
    if (!capBound) return open(state, vector, config, bestScore, best);
    // The cap forbids a new voice but not a wrong one. Chosen over falling
    // silent because a chip that never resolves is the design's one named
    // failure, and measured before it was chosen.
    return joined(best);
  }

  // The dead zone. Not placed, not lost — the caller holds it pending and fills
  // it later, and `nearest` is what it fills it with.
  return { state, assignment: { index: null, created: false, score: bestScore, nearest: best } };
}

/**
 * Start a voice, or take a step towards one.
 *
 * With `mintConfirmations` at 1 this is a plain mint. Above it, the vector either
 * corroborates the provisional voice it scores best against — at `tauAssign`,
 * the same bar a known voice is joined at — or opens a provisional voice of its
 * own. Either way the turn names nobody until a provisional voice holds enough
 * turns, and the turn that completes it is the one that mints it. A port of
 * `OnlineAttributor._open` in `online.py`, which the parity test holds it to.
 */
function open(
  state: AutoAttributionState,
  vector: readonly number[],
  config: AutoAttributionConfig,
  score: number,
  nearest: number | null,
): { state: AutoAttributionState; assignment: AutoAssignment } {
  if (config.mintConfirmations <= 1) {
    return {
      state: { ...state, clusters: [...state.clusters, { sum: [...vector], turns: 1 }] },
      assignment: {
        index: state.clusters.length,
        created: true,
        score,
        nearest: nearest ?? state.clusters.length,
      },
    };
  }

  let best = -1;
  let bestScore = -Infinity;
  for (let index = 0; index < state.provisional.length; index += 1) {
    const centroid = centroidOf(state.provisional[index]!);
    if (centroid.length !== vector.length) continue;
    const candidate = dot(centroid, vector);
    if (candidate > bestScore) {
      bestScore = candidate;
      best = index;
    }
  }

  if (best >= 0 && bestScore >= config.tauAssign) {
    const grown = fold(state.provisional[best]!, vector);
    if (grown.turns >= config.mintConfirmations && state.clusters.length < config.kMax) {
      return {
        state: {
          clusters: [...state.clusters, grown],
          provisional: state.provisional.filter((_, at) => at !== best),
        },
        assignment: { index: state.clusters.length, created: true, score, nearest },
      };
    }
    return {
      state: {
        ...state,
        provisional: state.provisional.map((cluster, at) => (at === best ? grown : cluster)),
      },
      assignment: { index: null, created: false, score, nearest },
    };
  }

  return {
    state: { ...state, provisional: [...state.provisional, { sum: [...vector], turns: 1 }] },
    assignment: { index: null, created: false, score, nearest },
  };
}

/**
 * Session end: provisional voices become speakers, most-corroborated first,
 * while the cap has room. Ties keep the order the voices were heard in.
 *
 * Safe against the display contract because a provisional voice never named a
 * turn — every turn it holds is still `pending` — so this adds ordinals and
 * moves none. `promoted` is how many were added, in order, after the existing
 * voices. The same rule as `OnlineAttributor.promote_provisional` in `online.py`.
 */
export function promoteProvisional(
  state: AutoAttributionState,
  config: AutoAttributionConfig = DEFAULT_AUTO_ATTRIBUTION,
): { state: AutoAttributionState; promoted: number } {
  const room = Math.max(0, config.kMax - state.clusters.length);
  if (room === 0 || state.provisional.length === 0) return { state, promoted: 0 };
  const order = state.provisional
    .map((cluster, at) => ({ cluster, at }))
    .sort((left, right) => right.cluster.turns - left.cluster.turns || left.at - right.at);
  const moving = order.slice(0, room);
  const moved = new Set(moving.map((entry) => entry.at));
  return {
    state: {
      clusters: [...state.clusters, ...moving.map((entry) => entry.cluster)],
      provisional: state.provisional.filter((_, at) => !moved.has(at)),
    },
    promoted: moving.length,
  };
}
