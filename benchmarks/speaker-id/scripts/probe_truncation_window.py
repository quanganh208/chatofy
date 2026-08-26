"""Is Checkpoint 1's KILL a real result, or an artifact of taking the first 2s?

Checkpoint 1 returned KILL at 23.0% EER. Before that ends the feature it has to
survive the same scepticism a suspiciously GOOD result would get, because a
false negative here is the expensive direction: it stops work that would have
worked.

**The specific doubt.** `run_pairwise.py` truncates each utterance to the bucket
length by taking its FIRST n seconds. VoxVietnam is in-the-wild YouTube and
TikTok audio, where a clip can open with music, applause, a jingle, or silence.
The plan is explicit that benches must cut audio the way production cuts it —
through the speech gate in `segment.py` — and this screen bypassed that. If the
first 2s of many clips is not speech, the screen measured noise against noise
and 23% says nothing about the models.

**The test.** Embed the same clips two ways and compare EER:

* `first` — the leading n seconds, what the screen did.
* `loudest` — the n-second window with the highest RMS, a cheap stand-in for
  "where the speech is".

If `loudest` is dramatically better, the KILL was a harness artifact and the
screen must be re-run through proper segmentation. If the two agree, the
truncation window is not the explanation and the KILL stands on this axis.

Run:
    uv run --directory benchmarks/speaker-id python scripts/probe_truncation_window.py
"""

from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

import numpy as np

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from speaker_bench.corpus import DEFAULT_CORPUS_DIR, iter_rows, load_index  # noqa: E402
from speaker_bench.embed import CANDIDATES, SpeakerEmbedder, cosine  # noqa: E402
from speaker_bench.pairs import build_trials  # noqa: E402
from speaker_bench.trials import compute_eer, split_scores, truncate_to  # noqa: E402

SAMPLE_RATE = 16_000
BUCKET_S = 2.0
PROBE_MODEL = "eres2netv2"

#: Subset size. The full screen is 100k embeddings and an hour; this only has to
#: separate "same answer" from "very different answer".
PAIR_LIMIT = 700


def loudest_window(samples: np.ndarray, seconds: float, sample_rate: int) -> np.ndarray:
    """The ``seconds``-long window with the highest RMS.

    A crude speech finder, deliberately: the point is to bound how much the
    choice of window matters, not to reimplement the speech gate. If this moves
    the number, the real fix is to run `segment.py` over the corpus.
    """
    want = int(round(seconds * sample_rate))
    if len(samples) <= want:
        return truncate_to(samples, seconds, sample_rate)
    # Cumulative energy makes every window's sum O(1) to read.
    energy = np.concatenate([[0.0], np.cumsum(samples.astype(np.float64) ** 2)])
    sums = energy[want:] - energy[:-want]
    start = int(np.argmax(sums))
    return samples[start : start + want]


def leading_silence_fraction(samples: np.ndarray, seconds: float, sample_rate: int) -> float:
    """How much quieter the leading window is than the clip's loudest one."""
    want = int(round(seconds * sample_rate))
    if len(samples) <= want:
        return 0.0
    head = float(np.sqrt(np.mean(samples[:want].astype(np.float64) ** 2)))
    best = float(np.sqrt(np.mean(loudest_window(samples, seconds, sample_rate).astype(np.float64) ** 2)))
    return 0.0 if best == 0 else 1.0 - head / best


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-dir", type=Path, default=DEFAULT_CORPUS_DIR)
    parser.add_argument("--index", type=Path, default=BENCH_ROOT / "corpora" / "voxvietnam-index.csv")
    parser.add_argument("--seed", type=int, default=20260824)
    args = parser.parse_args()

    index = load_index(args.index)
    pairs, _ = build_trials(index, BUCKET_S, random.Random(args.seed))
    rng = random.Random(args.seed)
    rng.shuffle(pairs)
    pairs = pairs[:PAIR_LIMIT]

    wanted = {u.order for pair in pairs for u in (pair.a, pair.b)}
    print(f"{len(pairs)} pairs, {len(wanted)} distinct utterances, model {PROBE_MODEL}")

    embedder = SpeakerEmbedder(CANDIDATES[PROBE_MODEL], num_threads=4)
    first_vectors: dict[int, np.ndarray] = {}
    loud_vectors: dict[int, np.ndarray] = {}
    quiet_heads = []
    highest = max(wanted)
    for utterance, samples in iter_rows(args.corpus_dir, with_audio=True):
        if utterance.order in wanted:
            assert samples is not None
            quiet_heads.append(leading_silence_fraction(samples, BUCKET_S, SAMPLE_RATE))
            first_vectors[utterance.order] = embedder.embed(
                truncate_to(samples, BUCKET_S, SAMPLE_RATE), sample_rate=SAMPLE_RATE
            )
            loud_vectors[utterance.order] = embedder.embed(
                loudest_window(samples, BUCKET_S, SAMPLE_RATE), sample_rate=SAMPLE_RATE
            )
        if utterance.order >= highest:
            break

    deficit = np.asarray(quiet_heads)
    print(
        f"\nleading window RMS vs loudest window: "
        f"p50 {100 * np.percentile(deficit, 50):.1f}% quieter, "
        f"p90 {100 * np.percentile(deficit, 90):.1f}%, "
        f"share >50% quieter: {100 * np.mean(deficit > 0.5):.1f}%"
    )

    print()
    results = {}
    for label, vectors in (("first", first_vectors), ("loudest", loud_vectors)):
        scores = [cosine(vectors[p.a.order], vectors[p.b.order]) for p in pairs]
        target, nontarget = split_scores(pairs, scores)
        result = compute_eer(target, nontarget)
        results[label] = result.eer
        print(
            f"{label:8s} EER {result.eer * 100:5.1f}%   "
            f"same {target.mean():.3f}+-{target.std():.3f}   "
            f"diff {nontarget.mean():.3f}+-{nontarget.std():.3f}"
        )

    change = results["first"] - results["loudest"]
    print("\n" + "=" * 70)
    if change > 0.03:
        print(
            f"THE TRUNCATION WINDOW MATTERS: {change * 100:.1f} points of EER.\n"
            "Checkpoint 1's KILL is contaminated by non-speech at clip starts and\n"
            "must be re-run through segment.py before the verdict is reported."
        )
    else:
        print(
            f"THE TRUNCATION WINDOW DOES NOT EXPLAIN THE RESULT ({change * 100:+.1f} points).\n"
            "Taking the loudest window instead of the first does not rescue the EER,\n"
            "so the KILL is not an artifact of where the audio was cut."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
