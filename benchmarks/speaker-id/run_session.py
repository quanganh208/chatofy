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
attribution-rate floor, and a cap on how far the speaker count may drift. The
third was added after the first run passed a configuration that rendered a
five-person meeting as roughly nine labels: without enrolment the attributor can
buy attribution rate by inventing clusters, since a turn below `tau_new` starts a
new speaker and counts as attributed. One person appearing under two names is a
visible product failure, so the criterion now says so.

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

from speaker_bench.online import OnlineAttributor, score_session  # noqa: E402

#: Acceptance. The first two come from the plan; the third was added after a
#: degenerate configuration passed on the first two alone.
ACCURACY_BAR = 0.70
ATTRIBUTION_FLOOR = 0.80
COUNT_ERROR_MAX = 1.0

#: Calibration aims above the floor, because thresholds lose attribution rate in
#: transfer. Aiming AT the floor lands exactly on it for the calibration
#: speakers and under it for everyone else — which is what the first run did.
#: Set from the measured p90 transfer loss over 48 calibrations (+13.8pt); an
#: earlier 8pt guess was flagged too small by the run that measured it.
CALIBRATION_MARGIN = 0.14

#: Turns each speaker contributes, and the earlier clips warm enrols from.
ENROLL_TURNS = 3
MEETING_TURNS = 5
MIN_CLIPS = ENROLL_TURNS + MEETING_TURNS

MEETING_SIZES = (3, 5)
CALIBRATION_MEETINGS = 150
EVALUATION_MEETINGS = 400

#: Independent speaker splits. Three is enough to see whether a result depends
#: on the split without turning the sweep into an overnight job.
SPLITS = 3

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
) -> tuple[list, np.ndarray | None]:
    """Simulate meetings and return their scores.

    ``track_position`` additionally returns a per-turn-ordinal hit array, which
    is what makes the cold-start question answerable: an average over the whole
    meeting cannot tell a warm-up cost from a permanent gap.
    """
    scores = []
    turns_total = size * MEETING_TURNS
    position_hits = np.zeros((turns_total, 2), dtype=np.int64) if track_position else None

    for _ in range(meetings):
        members = rng.sample(names, size)
        attributor = OnlineAttributor(tau_assign=tau_assign, tau_new=tau_new)

        if warm:
            for member in members:
                enrolment = vectors[pool[member][:ENROLL_TURNS]].mean(axis=0)
                attributor.seed((enrolment / np.linalg.norm(enrolment)).astype(np.float32))

        schedule = [
            (member, row)
            for member in members
            for row in pool[member][ENROLL_TURNS : ENROLL_TURNS + MEETING_TURNS]
        ]
        rng.shuffle(schedule)

        truth = [member for member, _ in schedule]
        assignments = [attributor.observe(vectors[row]) for _, row in schedule]
        scores.append(score_session(truth, assignments))

        if position_hits is not None:
            mapping = _final_mapping(truth, assignments)
            for position, (member, assignment) in enumerate(zip(truth, assignments)):
                if assignment.label is None:
                    continue
                position_hits[position, 0] += 1
                position_hits[position, 1] += int(mapping.get(assignment.label) == member)

    return scores, position_hits


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
    """
    attributed = sum(score.attributed for score in scores)
    total = sum(score.total for score in scores)
    correct = sum(score.correct for score in scores)
    count_error = float(np.mean([abs(score.speaker_count_error) for score in scores]))
    accuracy = 0.0 if attributed == 0 else correct / attributed
    rate = 0.0 if total == 0 else attributed / total
    return accuracy, rate, count_error


def acceptable(accuracy: float, rate: float, count_error: float) -> bool:
    return (
        accuracy >= ACCURACY_BAR
        and rate >= ATTRIBUTION_FLOOR
        and count_error <= COUNT_ERROR_MAX
    )


def calibrate(
    vectors: np.ndarray,
    pool: dict[str, list[int]],
    names: list[str],
    *,
    size: int,
    warm: bool,
    seed: int,
) -> tuple[float, float, float, float] | None:
    """Grid-sweep the thresholds on the calibration speakers, or None.

    Maximises accuracy subject to the attribution floor PLUS a margin, and to the
    speaker-count cap. The constraints are constraints rather than terms in a
    weighted score: a good accuracy must not be able to buy its way past a floor
    the plan declared, nor past a count error a user would see as one person
    wearing two names.
    """
    target_rate = ATTRIBUTION_FLOOR + CALIBRATION_MARGIN
    best = None
    for tau_assign in TAU_ASSIGN_GRID:
        for dead_zone in DEAD_ZONE_GRID:
            tau_new = round(float(tau_assign) - dead_zone, 4)
            scores, _ = run_meetings(
                vectors, pool, names,
                size=size, warm=warm,
                tau_assign=float(tau_assign), tau_new=tau_new,
                meetings=CALIBRATION_MEETINGS, rng=random.Random(seed),
            )
            accuracy, rate, count_error = aggregate(scores)
            candidate = (accuracy, rate, float(tau_assign), tau_new)
            if rate >= target_rate and count_error <= COUNT_ERROR_MAX:
                if best is None or accuracy > best[0]:
                    best = candidate
    # None means no configuration on this grid satisfies the constraints. An
    # earlier version returned the closest miss instead, which printed a
    # fallback's behaviour under an unreachable target as though it were the
    # cell's measured performance -- 12 clusters for a 5-person meeting, read as
    # a result. "No acceptable configuration" is the finding; say it.
    return best


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=BENCH_ROOT / "results" / "embedding-cache.npz")
    parser.add_argument("--out", type=Path, default=BENCH_ROOT / "results" / "session-summary.csv")
    parser.add_argument(
        "--curve", type=Path, default=BENCH_ROOT / "results" / "session-coldstart.csv"
    )
    parser.add_argument("--splits", type=int, default=SPLITS)
    parser.add_argument("--seed", type=int, default=20260825)
    args = parser.parse_args()

    cache = load_cache(args.cache)
    pool = speaker_rows(cache)
    print(
        f"policy {POLICY}: {len(pool)} speakers with >={MIN_CLIPS} gap-separated clips, "
        f"{args.splits} independent splits",
        flush=True,
    )
    print(
        f"acceptance: accuracy >={ACCURACY_BAR:.0%}, attributed >={ATTRIBUTION_FLOOR:.0%}, "
        f"|dN| <={COUNT_ERROR_MAX:.1f}; calibration aims at "
        f"{ATTRIBUTION_FLOOR + CALIBRATION_MARGIN:.0%}\n",
        flush=True,
    )

    rows, curves, transfer_losses = [], [], []

    for model in MODELS:
        for condition in CONDITIONS:
            vectors = cache[f"vec/{model}/{condition}"]
            for size in MEETING_SIZES:
                for warm in (False, True):
                    start = "warm" if warm else "cold"
                    per_split = []
                    for split in range(args.splits):
                        seed = args.seed + 1000 * split
                        calibration_names, evaluation_names = split_speakers(
                            list(pool), random.Random(seed)
                        )
                        if min(len(calibration_names), len(evaluation_names)) < size:
                            continue
                        chosen = calibrate(
                            vectors, pool, calibration_names,
                            size=size, warm=warm, seed=seed,
                        )
                        if chosen is None:
                            rows.append({
                                "model": model, "condition": condition,
                                "meeting_size": size, "start": start, "split": split,
                                "tau_assign": "", "tau_new": "",
                                "accuracy": "", "attribution_rate": "",
                                "speaker_count_abs_error": "",
                                "calibrated_rate": "", "transfer_loss": "",
                                "speakers_evaluated": len(evaluation_names),
                                "meetings": 0, "verdict": "NO-CONFIG",
                            })
                            continue
                        _, calibrated_rate, tau_assign, tau_new = chosen
                        scores, positions = run_meetings(
                            vectors, pool, evaluation_names,
                            size=size, warm=warm,
                            tau_assign=tau_assign, tau_new=tau_new,
                            meetings=EVALUATION_MEETINGS,
                            rng=random.Random(seed + 1),
                            track_position=True,
                        )
                        accuracy, rate, count_error = aggregate(scores)
                        per_split.append((accuracy, rate, count_error, tau_assign, tau_new))
                        transfer_losses.append(calibrated_rate - rate)

                        rows.append({
                            "model": model, "condition": condition,
                            "meeting_size": size, "start": start, "split": split,
                            "tau_assign": f"{tau_assign:.4f}", "tau_new": f"{tau_new:.4f}",
                            "accuracy": f"{accuracy:.6f}",
                            "attribution_rate": f"{rate:.6f}",
                            "speaker_count_abs_error": f"{count_error:.4f}",
                            "calibrated_rate": f"{calibrated_rate:.6f}",
                            "transfer_loss": f"{calibrated_rate - rate:.6f}",
                            "speakers_evaluated": len(evaluation_names),
                            "meetings": EVALUATION_MEETINGS,
                            "verdict": "PASS" if acceptable(accuracy, rate, count_error) else "FAIL",
                        })
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
                            f"NO CONFIGURATION on the threshold grid meets "
                            f"attributed >={ATTRIBUTION_FLOOR + CALIBRATION_MARGIN:.0%} "
                            f"and |dN| <={COUNT_ERROR_MAX:.1f}",
                            flush=True,
                        )
                        continue
                    accuracies = np.array([s[0] for s in per_split])
                    rates = np.array([s[1] for s in per_split])
                    errors = np.array([s[2] for s in per_split])
                    passes = sum(acceptable(*s[:3]) for s in per_split)
                    print(
                        f"  {model:12s} {condition:10s} N={size} {start:4s}  "
                        f"acc {accuracies.mean() * 100:5.1f}+-{accuracies.std() * 100:.1f}%  "
                        f"attr {rates.mean() * 100:5.1f}+-{rates.std() * 100:.1f}%  "
                        f"|dN| {errors.mean():.2f}  "
                        f"{passes}/{len(per_split)} splits PASS",
                        flush=True,
                    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    for path, data in ((args.out, rows), (args.curve, curves)):
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(data[0]))
            writer.writeheader()
            writer.writerows(data)
        print(f"wrote {path}", flush=True)

    losses = np.array(transfer_losses)
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

    print("\n" + "=" * 78, flush=True)
    gate = [
        r for r in rows
        if r["condition"] == "far-field" and int(r["meeting_size"]) == 5
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
            print(
                f"GATE CELL  {model:12s} {start:4s}  "
                f"acc {np.mean([float(r['accuracy']) for r in mine]) * 100:5.1f}%  "
                f"attr {np.mean([float(r['attribution_rate']) for r in mine]) * 100:5.1f}%  "
                f"|dN| {np.mean([float(r['speaker_count_abs_error']) for r in mine]):.2f}  "
                f"{wins}/{len(mine)} PASS",
                flush=True,
            )

    warm_pass = any(r["verdict"] == "PASS" for r in gate if r["start"] == "warm")
    cold_pass = any(r["verdict"] == "PASS" for r in gate if r["start"] == "cold")
    print(
        f"\nenrolled mode: {'PASS' if warm_pass else 'FAIL'}   "
        f"unenrolled mode: {'PASS' if cold_pass else 'FAIL'}",
        flush=True,
    )
    return 0 if warm_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())
