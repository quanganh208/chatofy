"""Bench 2 — simulated meeting, unknown speaker count.

Checkpoint 1 measured turn against turn and returned KILL. This measures what
the product would actually run: turns arriving in order, centroids accumulating
from the meeting's own audio, speakers discovered as they first talk. The
enrolment probe already showed those are not the same problem — 23.0% EER
turn-to-turn versus 88.3% accuracy against a centroid — so this bench exists to
find out how much of that gap survives when the centroid has to be built live
instead of handed over.

**Cold and warm differ by one line, and that is the point.** Both runs use the
same meeting, the same turns, in the same order. The warm run additionally seeds
each speaker's centroid from three earlier clips; the cold run starts from
nothing and discovers everyone. Every difference between the two numbers is
therefore the value of optional enrolment, measured rather than argued.

**Thresholds are calibrated on speakers this bench never scores.** The plan's
anti-circularity note warned against fitting and testing on the same data. The
speaker pool is split disjointly: one half sweeps the threshold grid, the other
half is evaluated once with the winner. That is stricter than the temporal split
the plan originally specified, and it is affordable only because
`build_embedding_cache.py` made the sweep a numpy operation rather than a
re-read of 4.3GB.

Exits non-zero when the evaluated configuration misses the acceptance bar, for
the reason Phase 6 gives: a number in prose gets rationalised, an exit code does
not.

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

#: Acceptance, straight from the plan: accuracy over attributed turns, with a
#: coverage floor beneath it so a configuration cannot buy accuracy by
#: abstaining on everything hard.
ACCURACY_BAR = 0.70
COVERAGE_FLOOR = 0.80

#: Turns each speaker contributes to a meeting, and the earlier clips the warm
#: run enrols from. A speaker needs both, so the pool is speakers with >=8
#: gap-separated clips.
ENROLL_TURNS = 3
MEETING_TURNS = 5
MIN_CLIPS = ENROLL_TURNS + MEETING_TURNS

MEETING_SIZES = (3, 5)
CALIBRATION_MEETINGS = 200
EVALUATION_MEETINGS = 500

MODELS = ("eres2netv2", "campplus")
CONDITIONS = ("clean", "far-field")

#: Only the gap-separated selection is scored. The unrestricted one is measured
#: alongside so the channel-inflation delta stays visible — Checkpoint 1's audit
#: found it worth 5.8 EER points, and a self-clustering bench is more exposed to
#: it than a pairwise one, not less.
POLICIES = ("spread", "adjacent")

TAU_ASSIGN_GRID = np.round(np.arange(0.25, 0.751, 0.025), 4)
DEAD_ZONE_GRID = (0.0, 0.05, 0.10, 0.15, 0.20, 0.25)


def load_cache(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(
            f"{path} is missing. Run: python scripts/build_embedding_cache.py"
        )
    return dict(np.load(path, allow_pickle=False))


def speaker_rows(cache: dict, policy: str) -> dict[str, list[int]]:
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
    is what makes the cold-start cost visible: an average over the whole meeting
    hides that the damage is concentrated in its first minute.
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
        score = score_session(truth, assignments)
        scores.append(score)

        if position_hits is not None:
            # Credit a turn only if its cluster is the one the final one-to-one
            # mapping gave that speaker. Recomputing per prefix would be a
            # different (and easier) question, so the mapping is the session's.
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
    """Pooled accuracy and coverage, plus mean absolute speaker-count error.

    Pooled rather than mean-of-means: a meeting where almost nothing was
    attributed would otherwise carry the same weight as a fully attributed one.
    """
    attributed = sum(score.attributed for score in scores)
    total = sum(score.total for score in scores)
    correct = sum(score.correct for score in scores)
    count_error = float(np.mean([abs(score.speaker_count_error) for score in scores]))
    accuracy = 0.0 if attributed == 0 else correct / attributed
    coverage = 0.0 if total == 0 else attributed / total
    return accuracy, coverage, count_error


def calibrate(
    vectors: np.ndarray,
    pool: dict[str, list[int]],
    names: list[str],
    *,
    size: int,
    warm: bool,
    seed: int,
) -> tuple[float, float, float, float]:
    """Grid-sweep the thresholds on the calibration speakers.

    Maximises accuracy subject to the coverage floor. A configuration that
    abstains its way to a high accuracy is not a better product, so the floor is
    a constraint rather than a term in a weighted score — weighting them would
    let a good accuracy buy its way past a coverage the plan declared a floor.
    """
    best = (-1.0, 0.0, 0.0, 0.0)
    fallback = (-1.0, 0.0, 0.0, 0.0)
    for tau_assign in TAU_ASSIGN_GRID:
        for dead_zone in DEAD_ZONE_GRID:
            tau_new = round(float(tau_assign) - dead_zone, 4)
            scores, _ = run_meetings(
                vectors, pool, names,
                size=size, warm=warm,
                tau_assign=float(tau_assign), tau_new=tau_new,
                meetings=CALIBRATION_MEETINGS, rng=random.Random(seed),
            )
            accuracy, coverage, _ = aggregate(scores)
            if coverage >= COVERAGE_FLOOR and accuracy > best[0]:
                best = (accuracy, coverage, float(tau_assign), tau_new)
            # Kept only so a total failure to reach the floor still reports the
            # configuration it came closest with, instead of an empty result.
            if coverage > fallback[1]:
                fallback = (accuracy, coverage, float(tau_assign), tau_new)
    return best if best[0] >= 0 else fallback


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=BENCH_ROOT / "results" / "embedding-cache.npz")
    parser.add_argument("--out", type=Path, default=BENCH_ROOT / "results" / "session-summary.csv")
    parser.add_argument(
        "--curve", type=Path, default=BENCH_ROOT / "results" / "session-coldstart.csv"
    )
    parser.add_argument("--seed", type=int, default=20260825)
    args = parser.parse_args()

    cache = load_cache(args.cache)
    rows, curves = [], []

    for policy in POLICIES:
        pool = speaker_rows(cache, policy)
        calibration_names, evaluation_names = split_speakers(
            list(pool), random.Random(args.seed)
        )
        print(
            f"\n=== policy {policy}: {len(pool)} speakers with >={MIN_CLIPS} clips "
            f"({len(calibration_names)} calibrate / {len(evaluation_names)} evaluate)",
            flush=True,
        )
        if len(evaluation_names) < max(MEETING_SIZES):
            print(f"  too few speakers to hold a {max(MEETING_SIZES)}-person meeting; skipped")
            continue

        for model in MODELS:
            for condition in CONDITIONS:
                vectors = cache[f"vec/{model}/{condition}"]
                for size in MEETING_SIZES:
                    if len(calibration_names) < size:
                        continue
                    for warm in (False, True):
                        start = "warm" if warm else "cold"
                        _, _, tau_assign, tau_new = calibrate(
                            vectors, pool, calibration_names,
                            size=size, warm=warm, seed=args.seed,
                        )
                        scores, positions = run_meetings(
                            vectors, pool, evaluation_names,
                            size=size, warm=warm,
                            tau_assign=tau_assign, tau_new=tau_new,
                            meetings=EVALUATION_MEETINGS,
                            rng=random.Random(args.seed + 1),
                            track_position=True,
                        )
                        accuracy, coverage, count_error = aggregate(scores)
                        verdict = (
                            "PASS"
                            if accuracy >= ACCURACY_BAR and coverage >= COVERAGE_FLOOR
                            else "FAIL"
                        )
                        rows.append({
                            "policy": policy, "model": model, "condition": condition,
                            "meeting_size": size, "start": start,
                            "tau_assign": f"{tau_assign:.4f}", "tau_new": f"{tau_new:.4f}",
                            "accuracy": f"{accuracy:.6f}", "coverage": f"{coverage:.6f}",
                            "speaker_count_abs_error": f"{count_error:.4f}",
                            "speakers_evaluated": len(evaluation_names),
                            "meetings": EVALUATION_MEETINGS, "verdict": verdict,
                        })
                        print(
                            f"  {model:12s} {condition:10s} N={size} {start:4s}  "
                            f"acc {accuracy * 100:5.1f}%  cov {coverage * 100:5.1f}%  "
                            f"|dN| {count_error:.2f}  "
                            f"tau {tau_assign:.3f}/{tau_new:.3f}  {verdict}",
                            flush=True,
                        )
                        if positions is not None:
                            for position, (seen, hit) in enumerate(positions):
                                curves.append({
                                    "policy": policy, "model": model, "condition": condition,
                                    "meeting_size": size, "start": start,
                                    "turn_ordinal": position,
                                    "attributed": int(seen),
                                    "correct": int(hit),
                                })

    args.out.parent.mkdir(parents=True, exist_ok=True)
    for path, data in ((args.out, rows), (args.curve, curves)):
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(data[0]))
            writer.writeheader()
            writer.writerows(data)
        print(f"wrote {path}", flush=True)

    gate = [
        row for row in rows
        if row["policy"] == "spread" and row["condition"] == "far-field"
        and int(row["meeting_size"]) == 5
    ]
    print("\n" + "=" * 78, flush=True)
    for row in gate:
        print(
            f"GATE CELL  {row['model']:12s} {row['start']:4s}  "
            f"acc {float(row['accuracy']) * 100:5.1f}%  cov {float(row['coverage']) * 100:5.1f}%  "
            f"{row['verdict']}",
            flush=True,
        )
    passed = [row for row in gate if row["verdict"] == "PASS"]
    if not passed:
        print(
            "\nNO CONFIGURATION CLEARS THE BAR on 2s far-field turns with 5 speakers.",
            flush=True,
        )
        return 1
    cold = [row for row in passed if row["start"] == "cold"]
    print(
        f"\n{len(passed)} of {len(gate)} gate configurations PASS. "
        + (
            "Cold start clears it too, so enrolment is genuinely optional."
            if cold
            else "Only warm starts clear it, so enrolment is required rather than optional."
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
