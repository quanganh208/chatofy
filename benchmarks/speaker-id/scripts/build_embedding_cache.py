"""Embed once, analyse many times.

Every experiment so far paid the same toll: stream 4.3GB of parquet, decode
audio, embed, then throw the vectors away. That was tolerable when each script
asked one question. It is not tolerable now — the online-attribution work needs
threshold sweeps, and a sweep that re-reads the corpus per candidate threshold
is not a sweep, it is a weekend.

So this writes the vectors down once. Everything downstream is then pure numpy
over a few hundred kilobytes, which is what makes held-out threshold calibration
affordable at all.

**Clip selection carries the rigour.** Turns are chosen greedily so that any two
clips from one speaker sit at least :data:`MIN_INDEX_GAP` rows apart, the rule
`probe_channel_leakage.py` measured into existence. It matters more here than it
did for the pairwise screen: an online attributor accumulates a centroid from a
speaker's own earlier turns, so if those turns came from one continuous
recording the centroid would model the recording and self-clustering would look
easy for reasons that vanish in a real meeting.

The unrestricted selection is cached alongside under its own key, so the same
analyses can be re-run without the rule and the difference reported as the
channel-inflation bound rather than assumed away.

Run:
    uv run --directory benchmarks/speaker-id python scripts/build_embedding_cache.py
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from speaker_bench.augment import (  # noqa: E402
    DEFAULT_SNR_DB,
    RoomConfig,
    build_rir,
    far_field,
)
from speaker_bench.corpus import DEFAULT_CORPUS_DIR, iter_rows, load_index  # noqa: E402
from speaker_bench.embed import CANDIDATES, SpeakerEmbedder  # noqa: E402
from speaker_bench.pairs import MIN_INDEX_GAP  # noqa: E402
from speaker_bench.trials import truncate_to  # noqa: E402

SAMPLE_RATE = 16_000

#: Turn length every cached vector is cut to. The gate cell, so the cache
#: measures the same thing Checkpoint 1 was read at.
TURN_S = 2.0

#: Cap per speaker. Enough for a speaker to hold a dozen turns in a simulated
#: meeting without one prolific voice dominating the corpus-wide statistics.
MAX_CLIPS_PER_SPEAKER = 12

MODELS = ("eres2netv2", "campplus")
CONDITIONS = ("clean", "far-field")

#: Selection policies cached side by side. "spread" is the honest one; "adjacent"
#: exists so the channel-inflation delta stays measurable rather than asserted.
POLICIES = ("spread", "adjacent")


def select_clips(index, *, min_gap: int) -> dict[str, list]:
    """Per speaker, clips of at least :data:`TURN_S`, greedily gap-separated.

    Greedy from the earliest clip is deliberate rather than optimal: it is
    reproducible without a seed, and maximising the count instead would bias
    selection toward speakers whose clips happen to fall on a convenient stride.
    """
    by_speaker: dict[str, list] = defaultdict(list)
    for utterance in index:
        if utterance.duration_s >= TURN_S:
            by_speaker[utterance.speaker].append(utterance)

    selected: dict[str, list] = {}
    for speaker, items in by_speaker.items():
        items.sort(key=lambda u: u.order)
        kept: list = []
        last = -(10**9)
        for utterance in items:
            if utterance.order - last >= min_gap:
                kept.append(utterance)
                last = utterance.order
            if len(kept) >= MAX_CLIPS_PER_SPEAKER:
                break
        if len(kept) >= 2:
            selected[speaker] = kept
    return selected


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-dir", type=Path, default=DEFAULT_CORPUS_DIR)
    parser.add_argument("--index", type=Path, default=BENCH_ROOT / "corpora" / "voxvietnam-index.csv")
    parser.add_argument("--out", type=Path, default=BENCH_ROOT / "results" / "embedding-cache.npz")
    parser.add_argument("--seed", type=int, default=20260825)
    args = parser.parse_args()

    index = load_index(args.index)
    policies = {
        "spread": select_clips(index, min_gap=MIN_INDEX_GAP),
        "adjacent": select_clips(index, min_gap=1),
    }
    for name, chosen in policies.items():
        sizes = np.array([len(v) for v in chosen.values()])
        print(
            f"{name:9s}: {len(chosen):3d} speakers, {sizes.sum():5d} clips, "
            f"median {int(np.median(sizes))}/speaker, "
            f">=6 clips: {(sizes >= 6).sum()}, >=8: {(sizes >= 8).sum()}",
            flush=True,
        )

    # One read of the corpus serves both policies; they overlap heavily.
    wanted: dict[int, list[tuple[str, str, int]]] = defaultdict(list)
    for policy, chosen in policies.items():
        for speaker, items in chosen.items():
            for position, utterance in enumerate(items):
                wanted[utterance.order].append((policy, speaker, position))
    print(f"{len(wanted)} distinct clips to embed", flush=True)

    room = RoomConfig()
    rir, measured_rt60 = build_rir(room)
    print(f"far-field room: {room.source_distance_m:.2f}m, RT60 {measured_rt60:.3f}s", flush=True)

    embedders = {name: SpeakerEmbedder(CANDIDATES[name], num_threads=4) for name in MODELS}
    noise_rng = np.random.default_rng(args.seed)

    vectors: dict[tuple[str, str], dict[int, np.ndarray]] = {
        (model, condition): {} for model in MODELS for condition in CONDITIONS
    }
    highest = max(wanted)
    done = 0
    for utterance, samples in iter_rows(args.corpus_dir, with_audio=True):
        if utterance.order in wanted:
            assert samples is not None
            clip = truncate_to(samples, TURN_S, SAMPLE_RATE)
            variants = {
                "clean": clip,
                "far-field": far_field(clip, rir, noise_rng, snr_db=DEFAULT_SNR_DB),
            }
            for model in MODELS:
                for condition, audio in variants.items():
                    vectors[(model, condition)][utterance.order] = embedders[model].embed(
                        audio, sample_rate=SAMPLE_RATE
                    )
            done += 1
            if done % 100 == 0:
                print(f"  {done}/{len(wanted)} embedded", flush=True)
        if utterance.order >= highest:
            break

    # Flatten to arrays. `orders` is the join key every consumer indexes by.
    orders = sorted(vectors[(MODELS[0], CONDITIONS[0])])
    position = {order: i for i, order in enumerate(orders)}
    payload: dict[str, np.ndarray] = {"orders": np.asarray(orders, dtype=np.int64)}
    for model in MODELS:
        for condition in CONDITIONS:
            payload[f"vec/{model}/{condition}"] = np.stack(
                [vectors[(model, condition)][order] for order in orders]
            )

    # Each policy is stored as a speaker-labelled, order-sorted membership table.
    for policy, chosen in policies.items():
        speakers, rows = [], []
        for speaker in sorted(chosen):
            for utterance in chosen[speaker]:
                speakers.append(speaker)
                rows.append(position[utterance.order])
        payload[f"policy/{policy}/speaker"] = np.asarray(speakers)
        payload[f"policy/{policy}/row"] = np.asarray(rows, dtype=np.int64)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.out, **payload)
    size_mb = args.out.stat().st_size / 1e6
    print(f"\nwrote {args.out} ({size_mb:.1f}MB, {len(orders)} clips x {len(MODELS)} models)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
