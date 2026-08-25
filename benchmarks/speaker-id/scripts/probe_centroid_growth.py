"""How fast does a centroid stop being a single turn?

Checkpoint 1 measured turn against turn: 23.0% EER far-field at 2s. The
enrolment probe measured turn against a centroid averaged from ~15s and got a
completely different answer. Neither number tells you what happens in between,
and in between is exactly where a live meeting spends its first minute.

This draws the curve. Same corpus, same room, same gap rule, one variable: how
many turns went into the centroid. k=1 is Checkpoint 1's regime by construction
— a centroid of one turn IS a turn — so the curve starts at the number that
killed the feature and shows what accumulation buys per additional turn.

Why it matters for the design: if the curve is flat, self-accumulation cannot
work and enrolment is mandatory. If it drops steeply in the first few turns,
then a meeting fixes itself as people talk, and enrolment only buys the opening
minute — which is the difference between a required setup step and an optional
one.

Reads the cache, so it costs seconds rather than an hour.

Run:
    uv run --directory benchmarks/speaker-id python scripts/probe_centroid_growth.py
"""

from __future__ import annotations

import argparse
import csv
import random
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from speaker_bench.trials import compute_eer  # noqa: E402

#: Centroid sizes swept. The pool is fixed at speakers holding at least
#: MAX_K + 1 clips for every k, so the curve is not confounded by the population
#: changing underneath it — a smaller pool at large k would look like an
#: improvement that is really a change of subject.
MAX_K = 5

MODELS = ("eres2netv2", "campplus")
CONDITIONS = ("clean", "far-field")
POLICY = "spread"

#: Non-target scores per centroid. Every other speaker's clips are available;
#: this caps the count so one enormous speaker cannot dominate.
NONTARGETS_PER_CENTROID = 40


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=BENCH_ROOT / "results" / "embedding-cache.npz")
    parser.add_argument("--out", type=Path, default=BENCH_ROOT / "results" / "centroid-growth.csv")
    parser.add_argument("--seed", type=int, default=20260825)
    args = parser.parse_args()

    if not args.cache.exists():
        raise FileNotFoundError(
            f"{args.cache} is missing. Run: python scripts/build_embedding_cache.py"
        )
    cache = dict(np.load(args.cache, allow_pickle=False))

    grouped: dict[str, list[int]] = defaultdict(list)
    for speaker, row in zip(cache[f"policy/{POLICY}/speaker"], cache[f"policy/{POLICY}/row"]):
        grouped[str(speaker)].append(int(row))
    pool = {name: rows for name, rows in grouped.items() if len(rows) >= MAX_K + 1}
    names = sorted(pool)
    print(f"{len(names)} speakers with >={MAX_K + 1} gap-separated clips", flush=True)

    rows = []
    for model in MODELS:
        for condition in CONDITIONS:
            vectors = cache[f"vec/{model}/{condition}"]
            print(f"\n{model} / {condition}", flush=True)
            for k in range(1, MAX_K + 1):
                rng = random.Random(args.seed + k)
                target, nontarget = [], []
                for name in names:
                    indices = pool[name]
                    centroid = vectors[indices[:k]].mean(axis=0)
                    centroid = centroid / np.linalg.norm(centroid)

                    # Held-out clips of the same speaker: never the ones averaged in.
                    for row in indices[k:]:
                        target.append(float(centroid @ vectors[row]))

                    others = [other for other in names if other != name]
                    for other in rng.sample(others, min(NONTARGETS_PER_CENTROID, len(others))):
                        nontarget.append(float(centroid @ vectors[rng.choice(pool[other])]))

                result = compute_eer(np.asarray(target), np.asarray(nontarget))
                rows.append({
                    "model": model, "condition": condition, "centroid_turns": k,
                    "eer": f"{result.eer:.6f}",
                    "target_mean": f"{np.mean(target):.4f}",
                    "target_std": f"{np.std(target):.4f}",
                    "nontarget_mean": f"{np.mean(nontarget):.4f}",
                    "target_scores": len(target), "nontarget_scores": len(nontarget),
                    "speakers": len(names),
                })
                print(
                    f"  centroid of {k} turn(s):  EER {result.eer * 100:5.1f}%   "
                    f"same {np.mean(target):.3f}+-{np.std(target):.3f}   "
                    f"diff {np.mean(nontarget):.3f}",
                    flush=True,
                )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nwrote {args.out}", flush=True)

    print("=" * 78, flush=True)
    for model in MODELS:
        cells = [r for r in rows if r["model"] == model and r["condition"] == "far-field"]
        first = float(cells[0]["eer"])
        last = float(cells[-1]["eer"])
        print(
            f"{model:12s} far-field: {first * 100:.1f}% at 1 turn -> {last * 100:.1f}% at "
            f"{MAX_K} turns ({(first - last) * 100:+.1f} points)",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
