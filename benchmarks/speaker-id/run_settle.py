"""Bench 2b — the offline settle pass, measured against the online arm.

The online attributor decides each turn against the centroids as they stood at
that moment. A finished session has no such constraint: every vector is
available at once, so re-clustering the whole session can repair labels the
live pass got wrong. Whether it *does* is the question here, and it is asked
against the same meetings the online arm ran, turn for turn.

**Merge and split are reported apart and never netted.** A settle pass that
repairs three splits while causing one merge is not "net +2". A split shows one
person under two ordinals — visible, correctable, and the user can fix it. A
merge folds two people into one ordinal, which in a translation app puts the
counterpart's words in the user's own mouth with nothing on screen to say so.
Only the two numbers side by side can decide whether the pass ships.

**The threshold is chosen on speakers it is never scored against.** The full
evaluation curve is emitted so the decision can read the whole shape, but the
one row flagged ``chosen`` had its threshold picked on the disjoint calibration
half. Reading the best point off the evaluation curve would be fitting and
reporting on the same speakers, which is the failure the online arm's split
exists to prevent — and it would overstate the settle pass precisely where the
comparison against the online arm matters.

Among calibration points the rule prefers the highest clean-session rate that
introduces **no merges at all**, falling back to the highest clean rate only if
every point merges. Merges are not traded against splits here for the reason
above.

Run:
    uv run --directory benchmarks/speaker-id python run_settle.py
"""

from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

import numpy as np

BENCH_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BENCH_ROOT))

from run_session import (  # noqa: E402
    CONDITIONS,
    EVALUATION_MEETINGS,
    MEETING_SIZES,
    MEETING_TURNS,
    MODELS,
    ORDERS,
    SPLITS,
    build_schedule,
    load_cache,
    speaker_rows,
    split_speakers,
)
from speaker_bench.io import write_rows  # noqa: E402
from speaker_bench.settle import settle, settle_errors  # noqa: E402

#: Cosine similarity thresholds to sweep. Same units as `tau_assign`, so a
#: settle threshold can be read directly beside the online one.
THRESHOLD_GRID = tuple(round(0.20 + 0.02 * step, 4) for step in range(26))


def measure(
    vectors: np.ndarray,
    pool: dict[str, list[int]],
    names: list[str],
    *,
    size: int,
    turns: int,
    order: str,
    threshold: float,
    k_max: int | None,
    meetings: int,
    seed: int,
) -> list:
    """Settle-pass errors over ``meetings`` meetings drawn from ``names``.

    The RNG is constructed here rather than passed in, so every threshold in a
    sweep sees exactly the same meetings and the curve reflects the threshold
    alone.
    """
    rng = random.Random(seed)
    errors = []
    for _ in range(meetings):
        members = rng.sample(names, size)
        schedule = build_schedule(pool, members, turns=turns, rng=rng, order=order)
        truth = [member for member, _ in schedule]
        turn_vectors = vectors[[row for _, row in schedule]]
        errors.append(settle_errors(truth, settle(turn_vectors, threshold=threshold, k_max=k_max)))
    return errors


def summarise(errors: list) -> tuple[float, float, float]:
    """``(clean_rate, split_extra_mean, merge_extra_mean)``."""
    return (
        float(np.mean([e.clean for e in errors])),
        float(np.mean([e.split_extra for e in errors])),
        float(np.mean([e.merge_extra for e in errors])),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=BENCH_ROOT / "results" / "embedding-cache.npz")
    parser.add_argument("--out", type=Path, default=BENCH_ROOT / "results" / "settle-sweep.csv")
    parser.add_argument("--splits", type=int, default=SPLITS)
    parser.add_argument("--seed", type=int, default=20260825)
    parser.add_argument("--turns", type=int, default=MEETING_TURNS)
    parser.add_argument("--meetings", type=int, default=EVALUATION_MEETINGS)
    parser.add_argument(
        "--k-max", type=int, default=None,
        help="bound the number of clusters the settle pass may produce",
    )
    parser.add_argument("--order", choices=ORDERS, default="shuffled")
    args = parser.parse_args()

    cache = load_cache(args.cache)
    pool = speaker_rows(cache)
    print(f"{len(pool)} speakers in the pool, {args.splits} splits", flush=True)

    rows = []
    for model in MODELS:
        for condition in CONDITIONS:
            vectors = cache[f"vec/{model}/{condition}"]
            for size in MEETING_SIZES:
                for split in range(args.splits):
                    seed = args.seed + 1000 * split
                    calibration_names, evaluation_names = split_speakers(
                        list(pool), random.Random(seed)
                    )
                    if min(len(calibration_names), len(evaluation_names)) < size:
                        continue

                    # Choose the threshold on the calibration half.
                    calibrated = []
                    for threshold in THRESHOLD_GRID:
                        clean, split_extra, merge = summarise(measure(
                            vectors, pool, calibration_names,
                            size=size, turns=args.turns, order=args.order,
                            threshold=threshold, k_max=args.k_max,
                            meetings=args.meetings, seed=seed,
                        ))
                        calibrated.append((threshold, clean, merge))
                    merge_free = [c for c in calibrated if c[2] == 0.0]
                    chosen_threshold = max(merge_free or calibrated, key=lambda c: c[1])[0]

                    # Report the whole curve on the evaluation half.
                    for threshold in THRESHOLD_GRID:
                        errors = measure(
                            vectors, pool, evaluation_names,
                            size=size, turns=args.turns, order=args.order,
                            threshold=threshold, k_max=args.k_max,
                            meetings=args.meetings, seed=seed + 1,
                        )
                        splits_extra = np.array([e.split_extra for e in errors])
                        merges = np.array([e.merge_extra for e in errors])
                        rows.append({
                            "model": model, "condition": condition,
                            "meeting_size": size, "split": split,
                            "turns_per_speaker": args.turns, "order": args.order,
                            "k_max": "" if args.k_max is None else args.k_max,
                            "threshold": f"{threshold:.4f}",
                            "chosen": int(threshold == chosen_threshold),
                            "clean_rate": f"{np.mean([e.clean for e in errors]):.6f}",
                            "split_extra_mean": f"{splits_extra.mean():.6f}",
                            "merge_extra_mean": f"{merges.mean():.6f}",
                            "sessions_with_a_merge": int((merges > 0).sum()),
                            "sessions_with_a_split": int((splits_extra > 0).sum()),
                            "speakers_evaluated": len(evaluation_names),
                            "meetings": args.meetings,
                        })

                    picked = next(r for r in rows if r["chosen"] and r["split"] == split
                                  and r["meeting_size"] == size and r["model"] == model
                                  and r["condition"] == condition)
                    print(
                        f"  {model:12s} {condition:10s} N={size} split {split}  "
                        f"tau {picked['threshold']} (held-out)  "
                        f"clean {float(picked['clean_rate']):.3f}  "
                        f"merge {float(picked['merge_extra_mean']):.3f}  "
                        f"split {float(picked['split_extra_mean']):.3f}",
                        flush=True,
                    )

    if not rows:
        print("no cell reached evaluation, so there is no settle sweep to write")
        return 1
    write_rows(args.out, rows)
    print(f"\nwrote {args.out}")

    # A settle pass earns its place by not introducing merges. Splits it can
    # trade against; merges are the invisible direction and the reason this
    # script reports them alone.
    chosen = [r for r in rows if r["chosen"]]
    merge_free = [r for r in chosen if float(r["merge_extra_mean"]) == 0.0]
    print(
        f"{len(merge_free)}/{len(chosen)} held-out cells are merge-free at the "
        f"calibrated threshold"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
