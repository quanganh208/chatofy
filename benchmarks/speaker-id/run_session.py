"""Bench 2 — simulated meeting, unknown speaker count, two operating modes.

Checkpoint 1 measured turn against turn and returned KILL. This measures what
the product would actually run: turns arriving in order, centroids accumulating
from the meeting's own audio, speakers discovered as they first talk.

**Two modes, because the product has two.** `cold` is a meeting where nobody
enrolled; `warm` is one where everybody did. Both run the same meetings, the same
turns, in the same order — the only difference is whether centroids are seeded
beforehand — so every cold/warm delta is enrolment's value, isolated. The product
offers enrolment as optional and degrades to `cold` without it, so both numbers
are shipping numbers and both are reported.

**Acceptance has three parts, not two.** Accuracy over attributed turns, an
attribution-rate floor, and a criterion on the speaker count. The third was added
after the first run passed a configuration that rendered a five-person meeting as
roughly nine labels: without enrolment the attributor can buy attribution rate by
inventing clusters, since a turn below `tau_new` starts a new speaker and counts
as attributed. One person appearing under two names is a visible product failure,
so the criterion now says so.

**The count criterion changes shape at N=2, because the absolute one is broken
there.** `|dN| <= 1.0` was written for meetings of three and five. At two, a
session that collapses both people into ONE cluster scores `|dN| = 1` and passes
— the worst outcome the product has, clearing the bar. So N=2 is judged on an
exact-count rate instead. Not a tightening: no bound that admits the worst case
can be tightened into one that does not.

**Every accuracy is reported twice.** `score_session` maps clusters onto speakers
with `linear_sum_assignment` after seeing ground truth, which the product never
has. The prefix-locked column scores the same meetings with the correspondence
fixed at cluster creation and never revised, and the gap between the two columns
is how much of the headline number is oracle.

**Thresholds are calibrated on speakers this bench never scores, several times
over.** The plan's anti-circularity note warned against fitting and testing on
the same data. The pool is split disjointly, calibrated on one half, evaluated on
the other — and the whole procedure repeats over several different splits, which
does two jobs at once: it stops one lucky split from carrying the result, and it
measures how much the thresholds lose in transfer. That loss is what the
calibration margin is set from, rather than guessed.

Run:
    uv run --directory benchmarks/speaker-id python run_session.py
"""

from __future__ import annotations

import argparse
import csv
import random
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

BENCH_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BENCH_ROOT))

from speaker_bench.online import (  # noqa: E402
    ABOVE_CAP_POLICIES,
    OnlineAttributor,
    score_session,
)
from speaker_bench.scoring import count_metrics, score_prefix_locked  # noqa: E402

#: Acceptance. The first two come from the plan; the third was added after a
#: degenerate configuration passed on the first two alone.
ACCURACY_BAR = 0.70
ATTRIBUTION_FLOOR = 0.80
COUNT_ERROR_MAX = 1.0

#: Acceptance at N=2, which is the product's dominant case and was never
#: measured. Both bars are tightened, for different reasons.
#:
#: Accuracy, because chance is 0.50 at two speakers, so 0.70 is 20 points above
#: guessing rather than the comfortable margin it reads as at N=5 — and because a
#: swapped chip in a TRANSLATION app puts the counterpart's words in the user's
#: mouth, which is worse than an unlabelled turn.
#:
#: The count, because ``COUNT_ERROR_MAX`` is not merely loose at N=2, it is wrong
#: in the dangerous direction: a session that collapses both people into ONE
#: cluster scores |dN| = 1 and PASSES a cap of 1.0. The worst outcome the product
#: has clears the bar. An exact-count rate has no such hole, so it replaces the
#: cap here rather than being tightened alongside it.
ACCURACY_BAR_N2 = 0.85
EXACT_COUNT_BAR_N2 = 0.90

#: Calibration aims above the floor, because thresholds lose attribution rate in
#: transfer. Aiming AT the floor lands exactly on it for the calibration
#: speakers and under it for everyone else — which is what the first run did.
#: Set from the measured p90 transfer loss over 48 calibrations (+13.8pt); an
#: earlier 8pt guess was flagged too small by the run that measured it.
CALIBRATION_MARGIN = 0.14

#: Turns each speaker contributes, and the earlier clips warm enrols from.
ENROLL_TURNS = 3
MEETING_TURNS = 5

#: Clips a speaker needs to be eligible at all. **Deliberately a constant rather
#: than ``ENROLL_TURNS + MEETING_TURNS``.** Derived, it silently re-drew the
#: speaker pool every time the meeting got longer: asking for 40-turn sessions
#: would demand 43 clips per speaker against a cache that holds at most 12, and
#: the run would not fail — it would quietly evaluate a smaller, more prolific
#: set of people and report the result as if the population had not moved. A
#: longer meeting now samples the same fixed pool with replacement instead, so
#: session length and pool composition are two knobs rather than one.
MIN_CLIPS = 8

#: N=2 first: it is the product's dominant case — one user, one counterpart —
#: and it has never been measured at any setting. N=5 stays reported and is
#: never gated on; real meetings here are 2-3 people.
MEETING_SIZES = (2, 3, 5)
CALIBRATION_MEETINGS = 150
EVALUATION_MEETINGS = 400

#: Independent speaker splits. Three is enough to see whether a result depends
#: on the split without turning the sweep into an overnight job.
SPLITS = 3

#: The cell the exit code and the printed gate follow. Two, not five.
GATE_SIZE = 2

#: Speaker sequences. `shuffled` is uniformly random; `alternating` is strict
#: round-robin, which is what two-person dialogue actually does. Neither is the
#: truth — reporting both is what makes the shuffled numbers interpretable.
ORDERS = ("shuffled", "alternating")

MODELS = ("eres2netv2", "campplus")
CONDITIONS = ("clean", "far-field")

#: Only the gap-separated selection is scored. The unrestricted one was measured
#: once (`adjacent`) to bound channel inflation at +12.3 accuracy points on the
#: gate cell; re-running it every time would only re-confirm a known number.
POLICY = "spread"

TAU_ASSIGN_GRID = np.round(np.arange(0.25, 0.751, 0.025), 4)
DEAD_ZONE_GRID = (0.05, 0.10, 0.15, 0.20, 0.25)


def load_cache(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(
            f"{path} is missing. Run: python scripts/build_embedding_cache.py"
        )
    return dict(np.load(path, allow_pickle=False))


def speaker_rows(cache: dict, policy: str = POLICY) -> dict[str, list[int]]:
    """Speaker -> cached row indices, in corpus order, for one selection policy."""
    speakers = cache[f"policy/{policy}/speaker"]
    rows = cache[f"policy/{policy}/row"]
    grouped: dict[str, list[int]] = defaultdict(list)
    for speaker, row in zip(speakers, rows):
        grouped[str(speaker)].append(int(row))
    return {name: items for name, items in grouped.items() if len(items) >= MIN_CLIPS}


def split_speakers(names: list[str], rng: random.Random) -> tuple[list[str], list[str]]:
    """Disjoint calibration and evaluation pools.

    Split by speaker rather than by turn: sharing a speaker across both halves
    would let the calibration see the exact voices it is later scored on, which
    is the circularity the plan warns about wearing a different hat.
    """
    shuffled = sorted(names)
    rng.shuffle(shuffled)
    cut = len(shuffled) // 2
    return shuffled[:cut], shuffled[cut:]


def build_schedule(
    pool: dict[str, list[int]],
    members: list[str],
    *,
    turns: int,
    rng: random.Random,
    order: str = "shuffled",
) -> list[tuple[str, int]]:
    """One meeting's turn sequence as ``(speaker, cache row)`` pairs.

    Shared by the online arm and the offline settle arm so that both are
    measured on the SAME meetings. A settle pass that re-implemented meeting
    construction could differ from the online arm by a shuffle and the
    comparison between them would silently stop being a comparison.
    """
    if order not in ORDERS:
        raise ValueError(f"order must be one of {ORDERS}, got {order!r}")
    per_member = [
        [(member, row) for row in _turn_rows(pool[member], turns, rng)]
        for member in members
    ]
    if order == "alternating":
        # Round-robin. Every speaker contributes `turns` rows, so the lists are
        # equal length and zip drops nothing.
        return [turn for group in zip(*per_member) for turn in group]
    schedule = [turn for group in per_member for turn in group]
    rng.shuffle(schedule)
    return schedule


def run_meetings(
    vectors: np.ndarray,
    pool: dict[str, list[int]],
    names: list[str],
    *,
    size: int,
    warm: bool,
    tau_assign: float,
    tau_new: float,
    meetings: int,
    rng: random.Random,
    track_position: bool = False,
    turns: int = MEETING_TURNS,
    attributor_options: dict | None = None,
    seed_members: int | None = None,
    order: str = "shuffled",
) -> tuple[list, list, np.ndarray | None]:
    """Simulate meetings and return their scores, twice over.

    Two score lists come back: the Hungarian one, and the prefix-locked one from
    the same meetings. They are not alternatives — the first is an upper bound
    computed with ground truth in hand, the second is what a product with no
    ground truth can actually reach, and the gap between them is a number nobody
    had before.

    ``turns`` is per speaker. Beyond what a speaker has clips for, turns are
    sampled WITH REPLACEMENT from that speaker's own pool rather than the
    eligibility floor being raised, so a longer session measures session length
    instead of quietly measuring a different set of people.

    ``attributor_options`` passes the bounded-K, deferred-mint and centroid
    arms through untouched; empty means the original unbounded attributor.

    ``track_position`` additionally returns a per-turn-ordinal hit array, which
    is what makes the cold-start question answerable: an average over the whole
    meeting cannot tell a warm-up cost from a permanent gap.

    ``seed_members`` bounds how many of the warm arm's members are actually
    enrolled. ``None`` seeds all of them, which is the original behaviour and
    the ceiling; ``1`` is the product's realistic case, where the device owner
    is known and nobody else is. The prefix-locked scorer is told exactly which
    members were seeded, so a half-warm meeting is not scored as if it were
    fully enrolled.

    ``order`` is ``shuffled`` (a uniformly random speaker sequence) or
    ``alternating`` (strict round-robin). Real two-person dialogue alternates,
    and a shuffled schedule hands the attributor consecutive same-speaker runs
    that a real conversation would not — so this is a validity check on every
    other number here, not a variant.
    """
    if order not in ORDERS:
        raise ValueError(f"order must be one of {ORDERS}, got {order!r}")
    scores, locked_scores = [], []
    turns_total = size * turns
    position_hits = np.zeros((turns_total, 2), dtype=np.int64) if track_position else None

    for _ in range(meetings):
        members = rng.sample(names, size)
        # Policy C's raised bar is an OFFSET, resolved here because only here is
        # `tau_assign` known. As an absolute it is meaningless under a sweep:
        # the grid spans 0.25-0.75, so any fixed value sits below `tau_assign`
        # somewhere in the sweep and `OnlineAttributor` rejects it outright.
        options = dict(attributor_options or {})
        delta = options.pop("tau_assign_capped_delta", None)
        if delta is not None:
            options["tau_assign_capped"] = min(tau_assign + delta, 1.0)
        attributor = OnlineAttributor(
            tau_assign=tau_assign, tau_new=tau_new, **options
        )

        # Which members enrolled. Seeding order follows `members`, so the
        # half-warm cell enrols a member drawn at random rather than a fixed
        # one — `rng.sample` already randomised the roster.
        seeded = members if seed_members is None else members[:seed_members]
        if not warm:
            seeded = []
        for member in seeded:
            enrolment = vectors[pool[member][:ENROLL_TURNS]].mean(axis=0)
            attributor.seed((enrolment / np.linalg.norm(enrolment)).astype(np.float32))

        schedule = build_schedule(pool, members, turns=turns, rng=rng, order=order)

        truth = [member for member, _ in schedule]
        assignments = [attributor.observe(vectors[row]) for _, row in schedule]
        scores.append(score_session(truth, assignments))
        locked_scores.append(
            score_prefix_locked(truth, assignments, seeded=seeded or None)
        )

        if position_hits is not None:
            mapping = _final_mapping(truth, assignments)
            for position, (member, assignment) in enumerate(zip(truth, assignments)):
                if assignment.label is None:
                    continue
                position_hits[position, 0] += 1
                position_hits[position, 1] += int(mapping.get(assignment.label) == member)

    return scores, locked_scores, position_hits


def _turn_rows(clips: list[int], turns: int, rng: random.Random) -> list[int]:
    """The clips one speaker contributes to one meeting.

    Short meetings take a deterministic prefix, exactly as before. Only when a
    meeting asks for more turns than the speaker has clips does sampling with
    replacement start — and then it is stated beside the number, because a
    repeated clip is an easier turn than a fresh one and the drift curve reads
    optimistic because of it.
    """
    available = clips[ENROLL_TURNS:]
    if not available:
        return []
    if len(available) >= turns:
        return available[:turns]
    return [rng.choice(available) for _ in range(turns)]


def _final_mapping(truth: list[str], assignments: list) -> dict[int, str]:
    """The cluster -> speaker correspondence the session ends up with."""
    from scipy.optimize import linear_sum_assignment

    speakers = sorted(set(truth))
    clusters = sorted({a.label for a in assignments if a.label is not None})
    if not clusters:
        return {}
    grid = np.zeros((len(clusters), len(speakers)), dtype=np.int64)
    cluster_at = {label: i for i, label in enumerate(clusters)}
    speaker_at = {name: i for i, name in enumerate(speakers)}
    for name, assignment in zip(truth, assignments):
        if assignment.label is not None:
            grid[cluster_at[assignment.label], speaker_at[name]] += 1
    rows, columns = linear_sum_assignment(-grid)
    return {clusters[row]: speakers[column] for row, column in zip(rows, columns)}


def aggregate(scores: list) -> tuple[float, float, float]:
    """Pooled accuracy and attribution rate, plus mean absolute count error.

    Pooled rather than mean-of-means: a meeting where almost nothing was
    attributed would otherwise carry the same weight as a fully attributed one.

    The absolute count error is kept for continuity with every published run.
    It is no longer what N=2 is judged on — see :func:`acceptable` — because it
    passes a total merge. :func:`speaker_bench.scoring.count_metrics` carries
    the signed error and the exact-count rate beside it.
    """
    attributed = sum(score.attributed for score in scores)
    total = sum(score.total for score in scores)
    correct = sum(score.correct for score in scores)
    count_error = float(np.mean([abs(score.speaker_count_error) for score in scores]))
    accuracy = 0.0 if attributed == 0 else correct / attributed
    rate = 0.0 if total == 0 else attributed / total
    return accuracy, rate, count_error


def accuracy_bar(size: int) -> float:
    return ACCURACY_BAR_N2 if size == 2 else ACCURACY_BAR


def acceptable(
    accuracy: float,
    rate: float,
    count_error: float,
    *,
    size: int,
    exact_rate: float | None = None,
) -> bool:
    """Whether one evaluated cell passes, on bars that depend on the meeting size.

    At N=2 the count criterion is the exact-count RATE, not the absolute error:
    the absolute cap admits the worst outcome the product has (both people
    rendered as one), so tightening it would not help and replacing it does.
    Everywhere else the inherited bars stand, so every earlier number stays
    comparable.
    """
    if accuracy < accuracy_bar(size) or rate < ATTRIBUTION_FLOOR:
        return False
    if size == 2:
        return exact_rate is not None and exact_rate >= EXACT_COUNT_BAR_N2
    return count_error <= COUNT_ERROR_MAX


def calibrate(
    vectors: np.ndarray,
    pool: dict[str, list[int]],
    names: list[str],
    *,
    size: int,
    warm: bool,
    seed: int,
    turns: int = MEETING_TURNS,
    attributor_options: dict | None = None,
    seed_members: int | None = None,
    order: str = "shuffled",
) -> tuple[tuple[float, float, float, float] | None, bool]:
    """Grid-sweep the thresholds on the calibration speakers.

    Maximises accuracy subject to the attribution floor PLUS a margin, and to the
    speaker-count criterion. The constraints are constraints rather than terms in
    a weighted score: a good accuracy must not be able to buy its way past a
    floor the plan declared, nor past a count error a user would see as one
    person wearing two names.

    Returns ``(best, loosened)``. **An empty grid is not a failed mechanism.**
    NO-CONFIG means no point on this grid satisfied BOTH calibration
    constraints at once — which is a statement about the grid and the margin,
    not about whether the attributor can attribute. Reporting it as FAIL merges
    two different findings into one word. So the sweep is scored twice off a
    single pass: once under the count constraint, and once without it. The
    second answer is reported as UNDETERMINED, with its number, and the
    evaluation-time bars do the judging where they belong.

    The count criterion mirrors :func:`acceptable`: an exact-count rate at N=2,
    the absolute cap elsewhere. Calibrating against a criterion the evaluation
    does not use would tune for one thing and grade on another.
    """
    target_rate = ATTRIBUTION_FLOOR + CALIBRATION_MARGIN
    rate_ok, both_ok = None, None

    for tau_assign in TAU_ASSIGN_GRID:
        for dead_zone in DEAD_ZONE_GRID:
            tau_new = round(float(tau_assign) - dead_zone, 4)
            scores, _, _ = run_meetings(
                vectors, pool, names,
                size=size, warm=warm,
                tau_assign=float(tau_assign), tau_new=tau_new,
                meetings=CALIBRATION_MEETINGS, rng=random.Random(seed),
                turns=turns, attributor_options=attributor_options,
                seed_members=seed_members, order=order,
            )
            accuracy, rate, count_error = aggregate(scores)
            if rate < target_rate:
                continue
            candidate = (accuracy, rate, float(tau_assign), tau_new)
            if rate_ok is None or accuracy > rate_ok[0]:
                rate_ok = candidate
            if size == 2:
                counts_ok = count_metrics(scores).exact_rate >= EXACT_COUNT_BAR_N2
            else:
                counts_ok = count_error <= COUNT_ERROR_MAX
            if counts_ok and (both_ok is None or accuracy > both_ok[0]):
                both_ok = candidate

    if both_ok is not None:
        return both_ok, False
    return rate_ok, True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=BENCH_ROOT / "results" / "embedding-cache.npz")
    parser.add_argument("--out", type=Path, default=BENCH_ROOT / "results" / "session-summary.csv")
    parser.add_argument(
        "--curve", type=Path, default=BENCH_ROOT / "results" / "session-coldstart.csv"
    )
    parser.add_argument("--splits", type=int, default=SPLITS)
    parser.add_argument("--seed", type=int, default=20260825)
    parser.add_argument(
        "--turns", type=int, default=MEETING_TURNS,
        help="turns per speaker; beyond a speaker's clips, sampled with replacement",
    )
    parser.add_argument(
        "--k-max", type=int, default=None,
        help="cap on speakers the attributor may create; unset means unbounded",
    )
    parser.add_argument(
        "--above-cap", default="assign", choices=list(ABOVE_CAP_POLICIES),
        help="what happens to a would-be new speaker once --k-max binds",
    )
    parser.add_argument("--tau-assign-capped", type=float, default=None)
    parser.add_argument(
        "--tau-assign-capped-delta", type=float, default=None,
        help="policy C's raised bar, as an offset above the swept tau_assign. "
             "Prefer this to the absolute form, which is undefined under a sweep.",
    )
    parser.add_argument("--centroid-cap", type=int, default=None, help="freeze after N turns")
    parser.add_argument("--centroid-window", type=int, default=None, help="track the last N turns")
    parser.add_argument("--mint-confirmations", type=int, default=1)
    parser.add_argument(
        "--seed-members", type=int, default=None,
        help="how many of the warm arm's members enrol (default: all). 1 is the "
             "device-owner case: one voice known, the rest discovered.",
    )
    parser.add_argument(
        "--order", choices=ORDERS, default="shuffled",
        help="speaker sequence; 'alternating' is round-robin dialogue",
    )
    args = parser.parse_args()
    if args.seed_members is not None and args.seed_members < 1:
        parser.error("--seed-members must be at least 1; the cold arm is the zero case")
    if args.tau_assign_capped is not None and args.tau_assign_capped_delta is not None:
        parser.error("pass --tau-assign-capped or --tau-assign-capped-delta, not both")

    options: dict = {}
    if args.k_max is not None:
        options["k_max"] = args.k_max
        options["above_cap"] = args.above_cap
        if args.tau_assign_capped is not None:
            options["tau_assign_capped"] = args.tau_assign_capped
        if args.tau_assign_capped_delta is not None:
            options["tau_assign_capped_delta"] = args.tau_assign_capped_delta
    if args.centroid_cap is not None:
        options["centroid_cap"] = args.centroid_cap
    if args.centroid_window is not None:
        options["centroid_window"] = args.centroid_window
    if args.mint_confirmations != 1:
        options["mint_confirmations"] = args.mint_confirmations

    cache = load_cache(args.cache)
    pool = speaker_rows(cache)
    clips = min(len(rows) for rows in pool.values()) if pool else 0
    # The duration the cached vectors were cut to. Older caches predate the
    # stamp; say so rather than implying a value, because every accuracy here
    # belongs to one turn length and is meaningless without it.
    turn_s = float(cache["turn_s"]) if "turn_s" in cache else None
    print(
        f"turn length: {f'{turn_s}s' if turn_s is not None else 'UNSTAMPED (pre-M1 cache)'}",
        flush=True,
    )
    print(
        f"policy {POLICY}: {len(pool)} speakers with >={MIN_CLIPS} gap-separated clips, "
        f"{args.splits} independent splits",
        flush=True,
    )
    if args.turns > clips - ENROLL_TURNS:
        print(
            f"  NOTE: {args.turns} turns per speaker exceeds the {clips - ENROLL_TURNS} "
            "meeting clips the thinnest speaker has, so turns are sampled WITH "
            "REPLACEMENT. A repeated clip is an easier turn than a fresh one; read "
            "the drift curve as optimistic.",
            flush=True,
        )
    print(
        f"acceptance: accuracy >={ACCURACY_BAR:.0%} (>={ACCURACY_BAR_N2:.0%} at N=2), "
        f"attributed >={ATTRIBUTION_FLOOR:.0%}, |dN| <={COUNT_ERROR_MAX:.1f} "
        f"(exact-count >={EXACT_COUNT_BAR_N2:.0%} at N=2); calibration aims at "
        f"{ATTRIBUTION_FLOOR + CALIBRATION_MARGIN:.0%}",
        flush=True,
    )
    print(f"attributor: {options or 'unbounded (the published baseline)'}\n", flush=True)

    rows, curves, transfer_losses = [], [], []

    for model in MODELS:
        for condition in CONDITIONS:
            vectors = cache[f"vec/{model}/{condition}"]
            for size in MEETING_SIZES:
                for warm in (False, True):
                    start = "warm" if warm else "cold"
                    # How many of the roster actually enrolled. Recorded per row
                    # rather than folded into `start`, so the gate keeps reading
                    # the cold cell by the same name it always did.
                    seeded_members = 0 if not warm else min(args.seed_members or size, size)
                    per_split = []
                    for split in range(args.splits):
                        seed = args.seed + 1000 * split
                        calibration_names, evaluation_names = split_speakers(
                            list(pool), random.Random(seed)
                        )
                        if min(len(calibration_names), len(evaluation_names)) < size:
                            continue
                        chosen, loosened = calibrate(
                            vectors, pool, calibration_names,
                            size=size, warm=warm, seed=seed,
                            turns=args.turns, attributor_options=options,
                            seed_members=args.seed_members, order=args.order,
                        )
                        if chosen is None:
                            rows.append({
                                "model": model, "condition": condition,
                                "meeting_size": size, "start": start, "split": split,
                                "turns_per_speaker": args.turns,
                                "seeded_members": seeded_members, "order": args.order,
                                "tau_assign": "", "tau_new": "",
                                "count_constraint": "unreachable",
                                "accuracy": "", "prefix_locked_accuracy": "",
                                "oracle_gap": "", "attribution_rate": "",
                                "speaker_count_abs_error": "",
                                "speaker_count_signed_error": "",
                                "exact_count_rate": "", "over_split_rate": "",
                                "merge_rate": "",
                                "calibrated_rate": "", "transfer_loss": "",
                                "speakers_evaluated": len(evaluation_names),
                                "meetings": 0, "verdict": "NO-CONFIG",
                                "prefix_locked_verdict": "NO-CONFIG",
                            })
                            continue
                        _, calibrated_rate, tau_assign, tau_new = chosen
                        scores, locked, positions = run_meetings(
                            vectors, pool, evaluation_names,
                            size=size, warm=warm,
                            tau_assign=tau_assign, tau_new=tau_new,
                            meetings=EVALUATION_MEETINGS,
                            rng=random.Random(seed + 1),
                            track_position=True,
                            turns=args.turns, attributor_options=options,
                            seed_members=args.seed_members, order=args.order,
                        )
                        accuracy, rate, count_error = aggregate(scores)
                        locked_accuracy, _, _ = aggregate(locked)
                        counts = count_metrics(scores)
                        passed = acceptable(
                            accuracy, rate, count_error,
                            size=size, exact_rate=counts.exact_rate,
                        )
                        verdict = (
                            "UNDETERMINED" if loosened else ("PASS" if passed else "FAIL")
                        )
                        # The same bar, applied to the column the PRODUCT can
                        # actually reach. `accuracy` is scored by Hungarian
                        # assignment against ground truth the product never has,
                        # so a cell can pass on it while the shippable number
                        # fails. Reported, never gated on: which column the bar
                        # judges is a plan decision, and this script's job is to
                        # make the divergence impossible to miss.
                        locked_passed = acceptable(
                            locked_accuracy, rate, count_error,
                            size=size, exact_rate=counts.exact_rate,
                        )
                        locked_verdict = (
                            "UNDETERMINED" if loosened
                            else ("PASS" if locked_passed else "FAIL")
                        )
                        per_split.append(
                            (accuracy, rate, count_error, counts.exact_rate, verdict)
                        )
                        transfer_losses.append(calibrated_rate - rate)

                        row = {
                            "model": model, "condition": condition,
                            "meeting_size": size, "start": start, "split": split,
                            "turns_per_speaker": args.turns,
                            "seeded_members": seeded_members, "order": args.order,
                            "tau_assign": f"{tau_assign:.4f}", "tau_new": f"{tau_new:.4f}",
                            "count_constraint": "loosened" if loosened else "applied",
                            "accuracy": f"{accuracy:.6f}",
                            "prefix_locked_accuracy": f"{locked_accuracy:.6f}",
                            "oracle_gap": f"{accuracy - locked_accuracy:.6f}",
                            "attribution_rate": f"{rate:.6f}",
                            "calibrated_rate": f"{calibrated_rate:.6f}",
                            "transfer_loss": f"{calibrated_rate - rate:.6f}",
                            "speakers_evaluated": len(evaluation_names),
                            "meetings": EVALUATION_MEETINGS,
                            # A cell whose thresholds came from a loosened sweep
                            # is not a pass and not a failure of the mechanism.
                            # It is a measured number taken under a calibration
                            # that could not satisfy both constraints, and it
                            # says so rather than borrowing either verdict.
                            "verdict": verdict,
                            "prefix_locked_verdict": locked_verdict,
                        }
                        row.update(counts.as_row())
                        rows.append(row)
                        if positions is not None and split == 0:
                            for position, (seen, hit) in enumerate(positions):
                                curves.append({
                                    "model": model, "condition": condition,
                                    "meeting_size": size, "start": start,
                                    "turn_ordinal": position,
                                    "attributed": int(seen), "correct": int(hit),
                                })

                    if not per_split:
                        print(
                            f"  {model:12s} {condition:10s} N={size} {start:4s}  "
                            f"NO CONFIGURATION on the threshold grid reaches "
                            f"attributed >={ATTRIBUTION_FLOOR + CALIBRATION_MARGIN:.0%}",
                            flush=True,
                        )
                        continue
                    accuracies = np.array([s[0] for s in per_split])
                    rates = np.array([s[1] for s in per_split])
                    errors = np.array([s[2] for s in per_split])
                    exact = np.array([s[3] for s in per_split])
                    verdicts = [s[4] for s in per_split]
                    passes = verdicts.count("PASS")
                    # Counted off the recorded verdicts, not off `acceptable`
                    # alone: a cell calibrated under a loosened count
                    # constraint is UNDETERMINED in the CSV, and a printed line
                    # that called the same cell a PASS would put two different
                    # answers to one question in two places.
                    undetermined = verdicts.count("UNDETERMINED")
                    print(
                        f"  {model:12s} {condition:10s} N={size} {start:4s}  "
                        f"acc {accuracies.mean() * 100:5.1f}+-{accuracies.std() * 100:.1f}%  "
                        f"attr {rates.mean() * 100:5.1f}+-{rates.std() * 100:.1f}%  "
                        f"|dN| {errors.mean():.2f}  exact {exact.mean() * 100:5.1f}%  "
                        f"{passes}/{len(per_split)} splits PASS"
                        + (f"  ({undetermined} UNDETERMINED)" if undetermined else ""),
                        flush=True,
                    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    for path, data, empty_reason in (
        (args.out, rows, "no cell produced a row"),
        (args.curve, curves, "no cell reached evaluation, so there is no cold-start curve"),
    ):
        # An empty result is a finding, not a crash. The `abstain` above-cap arm
        # reaches this legitimately: if no threshold pair clears the attribution
        # floor, every split is NO-CONFIG and no curve is ever appended. Indexing
        # row zero here threw away a completed sweep at the writing step.
        if not data:
            print(f"skipped {path}: {empty_reason}", flush=True)
            continue
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(data[0]))
            writer.writeheader()
            writer.writerows(data)
        print(f"wrote {path}", flush=True)

    losses = np.array(transfer_losses)
    if losses.size == 0:
        print(
            "\nno cell reached evaluation: every split was NO-CONFIG, so there is no "
            "transfer loss to report. That is a statement about the threshold grid "
            "and the calibration margin, not about the attributor.",
            flush=True,
        )
        return 1
    print(
        f"\nthreshold transfer loss across {losses.size} calibrations: "
        f"mean {losses.mean() * 100:+.1f}pt, p90 {np.percentile(losses, 90) * 100:+.1f}pt, "
        f"max {losses.max() * 100:+.1f}pt  (margin set at {CALIBRATION_MARGIN * 100:.0f}pt)",
        flush=True,
    )
    if np.percentile(losses, 90) > CALIBRATION_MARGIN:
        print(
            "  MARGIN TOO SMALL: 9 calibrations in 10 lose more than it allows, so the "
            "attribution floor will keep being missed in transfer.",
            flush=True,
        )

    gaps = np.array([float(r["oracle_gap"]) for r in rows if r["oracle_gap"]])
    if gaps.size:
        print(
            f"oracle gap (Hungarian minus prefix-locked) over {gaps.size} cells: "
            f"mean {gaps.mean() * 100:+.1f}pt, max {gaps.max() * 100:+.1f}pt. "
            "The prefix-locked column is the one a product without ground truth can reach.",
            flush=True,
        )

    print("\n" + "=" * 78, flush=True)
    # The gate cell is far-field N=2: the product's dominant case on the harder
    # of the two conditions. N=5 stays in the CSV and is never gated on -- real
    # meetings here are two or three people, and gating on five measured the
    # wrong product.
    gate = [
        r for r in rows
        if r["condition"] == "far-field" and int(r["meeting_size"]) == GATE_SIZE
        and r["verdict"] != "NO-CONFIG"
    ]
    for start in ("cold", "warm"):
        cells = [r for r in gate if r["start"] == start]
        for model in MODELS:
            mine = [r for r in cells if r["model"] == model]
            if not mine:
                print(f"GATE CELL  {model:12s} {start:4s}  no acceptable configuration", flush=True)
                continue
            wins = sum(1 for r in mine if r["verdict"] == "PASS")
            locked_wins = sum(1 for r in mine if r["prefix_locked_verdict"] == "PASS")
            print(
                f"GATE CELL  {model:12s} {start:4s}  "
                f"acc {np.mean([float(r['accuracy']) for r in mine]) * 100:5.1f}%  "
                f"locked {np.mean([float(r['prefix_locked_accuracy']) for r in mine]) * 100:5.1f}%  "
                f"attr {np.mean([float(r['attribution_rate']) for r in mine]) * 100:5.1f}%  "
                f"exact {np.mean([float(r['exact_count_rate']) for r in mine]) * 100:5.1f}%  "
                f"{wins}/{len(mine)} PASS  "
                f"(prefix-locked {locked_wins}/{len(mine)})",
                flush=True,
            )

    warm_pass = any(r["verdict"] == "PASS" for r in gate if r["start"] == "warm")
    cold_pass = any(r["verdict"] == "PASS" for r in gate if r["start"] == "cold")
    undetermined = [r for r in gate if r["verdict"] == "UNDETERMINED"]
    print(
        f"\nN={GATE_SIZE} far-field  enrolled mode: {'PASS' if warm_pass else 'FAIL'}   "
        f"unenrolled mode: {'PASS' if cold_pass else 'FAIL'}",
        flush=True,
    )
    if undetermined:
        print(
            f"  {len(undetermined)} gate rows are UNDETERMINED: their thresholds come from a "
            "sweep that could not satisfy the count constraint. Neither a pass nor a "
            "failure of the mechanism.",
            flush=True,
        )

    # The verdict above is scored with an oracle. Say so, loudly, whenever the
    # two columns disagree — a gate that passes only under Hungarian assignment
    # has not shown the product works, and the difference is easy to miss in a
    # wide table.
    # Counts, not `any`. The gate itself passes on `any` cold row, so a single
    # lucky split can carry it -- and would equally silence a warning written as
    # `any`. Comparing how many cells each column wins is what actually shows
    # the verdict leaning on the oracle.
    cold_rows = [r for r in gate if r["start"] == "cold"]
    cold_wins = sum(1 for r in cold_rows if r["verdict"] == "PASS")
    cold_locked_wins = sum(1 for r in cold_rows if r["prefix_locked_verdict"] == "PASS")
    if cold_wins > cold_locked_wins:
        print(
            f"\n  WARNING — the unenrolled verdict leans on the ORACLE: "
            f"{cold_wins}/{len(cold_rows)} cells pass on `accuracy`, only "
            f"{cold_locked_wins}/{len(cold_rows)} on prefix-locked.\n"
            "  `accuracy` maps clusters onto speakers with linear_sum_assignment "
            "AFTER seeing ground\n  truth. The product has no ground truth; "
            "prefix-locked is what it can reach.\n"
            "  Read the prefix-locked count as the shippable one.",
            flush=True,
        )
    # The exit code follows the UNENROLLED cell, because that is the product.
    # It used to follow the enrolled one, which reported success for a flow that
    # asks the user to enrol -- the flow this plan removed.
    return 0 if cold_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())
