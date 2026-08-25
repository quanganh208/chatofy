"""Is the coverage shortfall the algorithm, or the calibration?

`run_session.py` returns warm starts that label turns very well (93-94% accuracy,
speaker count off by 0.6 on a 5-person meeting) and then fail the gate on
coverage, at ~71% against an 80% floor. Two very different stories fit that:

* **The algorithm cannot do better.** No threshold pair reaches 80% coverage
  without wrecking accuracy, and the design is out of room.
* **The calibration aimed badly.** The sweep maximises accuracy subject to
  coverage >= 0.80 *on the calibration speakers*, which lands on a point sitting
  exactly at the floor. Any drop in transfer then pushes it under. A calibration
  targeting coverage with margin would transfer.

These call for opposite responses, so guessing is not acceptable. This sweeps the
same grid directly on the EVALUATION speakers and reports the best reachable
point. That is an oracle — it sees the data it is scored on, exactly the
circularity `run_session.py` exists to avoid — so its number is **not** a result
and must never be quoted as one. It is an upper bound, and the distance between
it and the honest held-out number is the measured cost of threshold
non-stationarity, which the plan asks for by name.

Run:
    uv run --directory benchmarks/speaker-id python scripts/probe_threshold_transfer.py
"""

from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

import numpy as np

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from run_session import (  # noqa: E402
    ACCURACY_BAR,
    COVERAGE_FLOOR,
    DEAD_ZONE_GRID,
    EVALUATION_MEETINGS,
    TAU_ASSIGN_GRID,
    aggregate,
    load_cache,
    run_meetings,
    speaker_rows,
    split_speakers,
)

CELLS = (
    ("campplus", "far-field", 5, True),
    ("campplus", "far-field", 5, False),
    ("eres2netv2", "far-field", 5, True),
    ("campplus", "far-field", 3, True),
)
POLICY = "spread"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=BENCH_ROOT / "results" / "embedding-cache.npz")
    parser.add_argument("--seed", type=int, default=20260825)
    args = parser.parse_args()

    cache = load_cache(args.cache)
    pool = speaker_rows(cache, POLICY)
    _, evaluation_names = split_speakers(list(pool), random.Random(args.seed))
    print(f"oracle sweep over {len(evaluation_names)} evaluation speakers\n", flush=True)

    for model, condition, size, warm in CELLS:
        vectors = cache[f"vec/{model}/{condition}"]
        best = None
        for tau_assign in TAU_ASSIGN_GRID:
            for dead_zone in DEAD_ZONE_GRID:
                tau_new = round(float(tau_assign) - dead_zone, 4)
                scores, _ = run_meetings(
                    vectors, pool, evaluation_names,
                    size=size, warm=warm,
                    tau_assign=float(tau_assign), tau_new=tau_new,
                    meetings=EVALUATION_MEETINGS // 2,
                    rng=random.Random(args.seed + 1),
                )
                accuracy, coverage, count_error = aggregate(scores)
                if coverage < COVERAGE_FLOOR:
                    continue
                if best is None or accuracy > best[0]:
                    best = (accuracy, coverage, count_error, float(tau_assign), tau_new)

        start = "warm" if warm else "cold"
        if best is None:
            print(
                f"{model:12s} {condition} N={size} {start:4s}: "
                f"NO threshold pair reaches {COVERAGE_FLOOR:.0%} coverage — "
                "the shortfall is the algorithm, not the calibration",
                flush=True,
            )
            continue
        accuracy, coverage, count_error, tau_assign, tau_new = best
        verdict = "would PASS" if accuracy >= ACCURACY_BAR else "would still FAIL"
        print(
            f"{model:12s} {condition} N={size} {start:4s}: "
            f"best reachable acc {accuracy * 100:5.1f}%  cov {coverage * 100:5.1f}%  "
            f"|dN| {count_error:.2f}  at tau {tau_assign:.3f}/{tau_new:.3f}  -> {verdict}",
            flush=True,
        )

    print(
        "\nThese are ORACLE numbers: the thresholds were chosen on the speakers they are\n"
        "scored on. Quote them only as an upper bound, never as the bench result.",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
