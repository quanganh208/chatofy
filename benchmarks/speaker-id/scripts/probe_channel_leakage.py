"""Does same-speaker similarity fall with distance in scan order?

This decides Phase 3's pair-construction rule, so it runs BEFORE the screen.

**The problem.** The plan's rule for same-speaker pairs is that they must be
temporally distant and cross-position, because pairs drawn from one continuous
recording share microphone, room, codec and AGC state. Their cosine is then
inflated by shared channel rather than shared identity: EER comes out low and
the gate passes a model that will fail in the room.

VoxVietnam ships `{audio, speaker}` and nothing else — no video id, no session,
no timestamp. So the rule cannot be enforced directly. The only signal left is
position in scan order, because the corpus was assembled per speaker per source,
which makes neighbouring rows likelier to share a video than distant ones.

**The measurement.** Take same-speaker pairs at a range of index gaps and see
whether similarity actually decays with the gap.

- If it decays, order is a usable proxy: Phase 3 requires a minimum gap, and the
  cost of the mitigation is known.
- If it does not, the proxy is worthless. Phase 3 must then report an explicit
  caveat that its EER is optimistic by an unmeasured amount, rather than imply a
  mitigation it does not have.

Either way the result is honest. What would not be honest is picking a gap
threshold that sounds prudent and never checking it does anything.

Run:
    uv run --directory benchmarks/speaker-id python scripts/probe_channel_leakage.py
"""

from __future__ import annotations

import argparse
import random
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from speaker_bench.corpus import (  # noqa: E402
    DEFAULT_CORPUS_DIR,
    Utterance,
    iter_rows,
    load_index,
)
from speaker_bench.embed import CANDIDATES, SpeakerEmbedder, cosine  # noqa: E402
from speaker_bench.io import write_rows  # noqa: E402
from speaker_bench.trials import truncate_to  # noqa: E402

BENCH_ROOT = Path(__file__).resolve().parent.parent

#: Gap buckets, in scan positions. Chosen to span from "almost certainly the
#: same source recording" to "certainly a different one", so a decay curve has
#: room to appear.
GAP_BUCKETS = ((1, 5), (5, 25), (25, 100), (100, 1_000), (1_000, 10_000), (10_000, 10**9))

#: One duration for the probe. The question is about channel, not duration, and
#: fixing it keeps the comparison clean. 3s is the best-populated bucket.
PROBE_SECONDS = 3.0

#: Pairs per gap bucket. Enough for a stable mean; the probe is a decision aid,
#: not the gate.
PAIRS_PER_BUCKET = 220

#: One model. The question is about the DATA, not the model, and a channel
#: effect visible to one embedder is visible to all. campplus is the cheapest.
PROBE_MODEL = "campplus"

SAMPLE_RATE = 16_000


def _eligible(index: list[Utterance]) -> dict[str, list[Utterance]]:
    """Speakers with at least two clips long enough for the probe duration."""
    by_speaker: dict[str, list[Utterance]] = defaultdict(list)
    for utterance in index:
        if utterance.duration_s >= PROBE_SECONDS:
            by_speaker[utterance.speaker].append(utterance)
    return {
        speaker: sorted(items, key=lambda u: u.order)
        for speaker, items in by_speaker.items()
        if len(items) >= 2
    }


def _sample_pairs(
    by_speaker: dict[str, list[Utterance]], rng: random.Random
) -> dict[tuple[int, int], list[tuple[Utterance, Utterance]]]:
    """Same-speaker pairs bucketed by index gap, balanced across speakers.

    Round-robin over speakers rather than sampling pairs uniformly: one speaker
    holds up to 1,458 clips in this bucket while the median holds 16, so uniform
    sampling would fill every gap bucket with the same few voices and the decay
    curve would describe them rather than the corpus.
    """
    out: dict[tuple[int, int], list[tuple[Utterance, Utterance]]] = {
        bucket: [] for bucket in GAP_BUCKETS
    }
    speakers = sorted(by_speaker)
    for bucket in GAP_BUCKETS:
        low, high = bucket
        attempts = 0
        while len(out[bucket]) < PAIRS_PER_BUCKET and attempts < PAIRS_PER_BUCKET * 200:
            attempts += 1
            speaker = speakers[attempts % len(speakers)]
            items = by_speaker[speaker]
            if len(items) < 2:
                continue
            first = rng.randrange(len(items))
            second = rng.randrange(len(items))
            if first == second:
                continue
            a, b = items[first], items[second]
            gap = abs(a.order - b.order)
            if low <= gap < high:
                out[bucket].append((a, b))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-dir", type=Path, default=DEFAULT_CORPUS_DIR)
    parser.add_argument("--index", type=Path, default=BENCH_ROOT / "corpora" / "voxvietnam-index.csv")
    parser.add_argument("--models-dir", type=Path, default=BENCH_ROOT / "models")
    parser.add_argument("--out", type=Path, default=BENCH_ROOT / "results" / "channel-leakage.csv")
    parser.add_argument("--seed", type=int, default=20260824)
    args = parser.parse_args()

    index = load_index(args.index)
    by_speaker = _eligible(index)
    print(f"{len(index)} utterances, {len(by_speaker)} speakers with >=2 clips of >={PROBE_SECONDS}s")

    rng = random.Random(args.seed)
    buckets = _sample_pairs(by_speaker, rng)
    for bucket, pairs in buckets.items():
        print(f"  gap [{bucket[0]}, {bucket[1]}): {len(pairs)} pairs")

    wanted = {u.order: u for pairs in buckets.values() for pair in pairs for u in pair}
    print(f"\nembedding {len(wanted)} distinct utterances with {PROBE_MODEL} ...")

    spec = CANDIDATES[PROBE_MODEL]
    embedder = SpeakerEmbedder(spec, num_threads=2)
    vectors: dict[int, np.ndarray] = {}
    highest = max(wanted)
    for utterance, samples in iter_rows(args.corpus_dir, with_audio=True):
        if utterance.order in wanted:
            assert samples is not None
            vectors[utterance.order] = embedder.embed(
                truncate_to(samples, PROBE_SECONDS, SAMPLE_RATE), sample_rate=SAMPLE_RATE
            )
        if utterance.order >= highest:
            break

    rows = []
    print("\ngap bucket            n   mean cos   p50     p10")
    summary = []
    for bucket, pairs in buckets.items():
        scores = []
        for a, b in pairs:
            score = cosine(vectors[a.order], vectors[b.order])
            scores.append(score)
            rows.append(
                {
                    "gap_low": bucket[0],
                    "gap_high": bucket[1],
                    "speaker": a.speaker,
                    "order_a": a.order,
                    "order_b": b.order,
                    "gap": abs(a.order - b.order),
                    "cosine": f"{score:.6f}",
                }
            )
        if not scores:
            continue
        arr = np.asarray(scores)
        summary.append((bucket, arr))
        print(
            f"[{bucket[0]:>5}, {bucket[1]:>6}) {len(arr):5d}   "
            f"{arr.mean():.4f}   {np.percentile(arr, 50):.4f}  {np.percentile(arr, 10):.4f}"
        )

    write_rows(args.out, rows, fieldnames=["gap_low", "gap_high", "speaker", "order_a", "order_b", "gap", "cosine"])
    print(f"\nwrote {len(rows)} rows -> {args.out}")

    if len(summary) >= 2:
        near = summary[0][1].mean()
        far = summary[-1][1].mean()
        drop = near - far
        print("\n" + "=" * 66)
        print(f"nearest bucket mean {near:.4f}   farthest {far:.4f}   drop {drop:+.4f}")
        if drop > 0.02:
            print(
                "ORDER IS A USABLE PROXY. Same-speaker similarity falls with index gap,\n"
                "so adjacent clips do share channel. Phase 3 must require a minimum gap,\n"
                "and the drop above is the size of the inflation being removed."
            )
        else:
            print(
                "ORDER IS NOT A USABLE PROXY. Similarity does not fall with index gap,\n"
                "so a gap rule would be a mitigation in name only. Phase 3 must instead\n"
                "report that its same-speaker pairs may share a source recording, and\n"
                "that its EER is optimistic by an amount this corpus cannot reveal."
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
