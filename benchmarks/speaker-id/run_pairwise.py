"""Checkpoint 1 — the pairwise EER screen, and the first kill gate.

Measures how well each candidate model separates same-speaker from
different-speaker pairs, per duration bucket, on two channel conditions. Selects
a model, derives candidate thresholds, and exits non-zero when the gate fails.

WHAT THIS SCREEN IS, STATED PRECISELY, BECAUSE THE VERDICT DEPENDS ON IT:

* Pairs come from VoxVietnam's test split, not a self-recording. 150 speakers.
* Same-speaker pairs are separated by at least `MIN_INDEX_GAP` scan positions,
  because adjacent clips measurably share channel (+0.096 cosine) and would
  inflate the result. The corpus has no session id, so this is a proxy: two
  clips 25 rows apart may still share a video. The residual is unmeasurable
  here and is a stated limitation of the number, not a solved problem.
* Negatives are matched on NOTHING — the corpus carries no gender or dialect
  labels — which makes them easier than Vietnam-Celeb-H's matched negatives.
  This screen is therefore weaker than the plan originally specified.
* `far-field` is a SIMULATED room (2.00m, measured RT60 0.507s) plus noise at
  15dB SNR, stacked on already-broadcast-processed audio. It is the harder of
  the two cells and the gate reads it, but it is not production's channel:
  there is no browser DSP anywhere in this screen. Phase 7 measures that.

So Checkpoint 1 is necessary but not sufficient, exactly as the plan says. A
pass here does not mean the feature works in the room.
"""

from __future__ import annotations

import argparse
import math
import random
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

BENCH_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BENCH_ROOT))

from speaker_bench.augment import (  # noqa: E402
    DEFAULT_SNR_DB,
    RoomConfig,
    build_rir,
    far_field,
)
from speaker_bench.corpus import DEFAULT_CORPUS_DIR, iter_rows, load_index  # noqa: E402
from speaker_bench.embed import CANDIDATES, SpeakerEmbedder, cosine  # noqa: E402
from speaker_bench.io import write_rows  # noqa: E402
from speaker_bench.pairs import MAX_PAIRS_PER_SPEAKER, MIN_INDEX_GAP, build_trials  # noqa: E402
from speaker_bench.trials import DURATION_BUCKETS_S, compute_eer, truncate_to  # noqa: E402

SAMPLE_RATE = 16_000

#: Channel conditions, reported as separate cells and never pooled.
CONDITIONS = ("clean", "far-field")

#: The condition the gate reads. The conservative of the two.
GATE_CONDITION = "far-field"

#: The bucket the gate reads, per the plan: short turns are the regime in doubt.
GATE_BUCKET_S = 2.0

#: Checkpoint 1 thresholds, from the plan. EER at or under PASS_EER passes;
#: above KILL_EER kills; between them is MARGINAL and triggers the TEN VAD
#: remediation lever before a decision.
PASS_EER = 0.10
KILL_EER = 0.15

#: tau_hi targets ~1% false-accept on non-target pairs: a wrong merge poisons a
#: centroid, so the merge side is the conservative one.
TAU_HI_FAR = 0.01
#: tau_lo targets ~10% miss on target pairs. Between them is the dead zone,
#: whose width is an OUTPUT of this phase.
TAU_LO_FRR = 0.10

EXIT_GATE_FAILED = 1
EXIT_INCOMPLETE = 3


def threshold_at_far(nontarget: np.ndarray, far: float) -> float:
    """Score above which at most ``far`` of non-target pairs land."""
    return float(np.quantile(nontarget, 1.0 - far))


def threshold_at_frr(target: np.ndarray, frr: float) -> float:
    """Score below which at most ``frr`` of target pairs land."""
    return float(np.quantile(target, frr))


def classify(eer: float) -> str:
    """PASS / MARGINAL / KILL for one cell. Extracted so it is testable."""
    if eer <= PASS_EER:
        return "PASS"
    if eer <= KILL_EER:
        return "MARGINAL"
    return "KILL"


def _histogram(path: Path, target: np.ndarray, nontarget: np.ndarray, title: str) -> None:
    """Same/diff cosine histogram.

    Required by the bench output rules because a single EER hides a bimodal
    distribution, and a bimodal same-speaker distribution is the signature of a
    subgroup the model fails on entirely.
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    figure, axis = plt.subplots(figsize=(7, 4))
    bins = np.linspace(-0.2, 1.0, 80)
    axis.hist(nontarget, bins=bins, alpha=0.6, label=f"different ({len(nontarget)})")
    axis.hist(target, bins=bins, alpha=0.6, label=f"same ({len(target)})")
    axis.set_title(title)
    axis.set_xlabel("cosine similarity")
    axis.set_ylabel("pairs")
    axis.legend()
    figure.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(path, dpi=110)
    plt.close(figure)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-dir", type=Path, default=DEFAULT_CORPUS_DIR)
    parser.add_argument("--index", type=Path, default=BENCH_ROOT / "corpora" / "voxvietnam-index.csv")
    parser.add_argument("--results-dir", type=Path, default=BENCH_ROOT / "results")
    parser.add_argument("--models", nargs="*", default=list(CANDIDATES))
    parser.add_argument("--max-pairs-per-speaker", type=int, default=MAX_PAIRS_PER_SPEAKER)
    parser.add_argument("--min-index-gap", type=int, default=MIN_INDEX_GAP)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--seed", type=int, default=20260824)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="build the trial lists and report their size, then stop before embedding",
    )
    args = parser.parse_args()

    index = load_index(args.index)
    rng = random.Random(args.seed)

    trials_by_bucket = {}
    for bucket in DURATION_BUCKETS_S:
        pairs, stats = build_trials(
            index,
            bucket,
            rng,
            min_index_gap=args.min_index_gap,
            max_per_speaker=args.max_pairs_per_speaker,
        )
        trials_by_bucket[bucket] = (pairs, stats)
        print(
            f"{bucket:.0f}s bucket: {stats['target_pairs']} same + "
            f"{stats['nontarget_pairs']} diff pairs, "
            f"{stats['speakers_contributing_targets']}/{stats['speakers_eligible']} speakers"
        )

    needed: dict[int, set[float]] = defaultdict(set)
    for bucket, (pairs, _) in trials_by_bucket.items():
        for pair in pairs:
            needed[pair.a.order].add(bucket)
            needed[pair.b.order].add(bucket)
    work = sum(len(buckets) for buckets in needed.values())
    print(
        f"\n{len(needed)} distinct utterances, {work} utterance-bucket combinations\n"
        f"{work * len(CONDITIONS) * len(args.models)} embeddings to compute"
    )
    if args.dry_run:
        print("\n--dry-run: stopping before embedding")
        return 0

    room = RoomConfig()
    rir, measured_rt60 = build_rir(room)
    print(
        f"\nfar-field: {room.source_distance_m:.2f}m source distance, "
        f"measured RT60 {measured_rt60:.3f}s, noise at {DEFAULT_SNR_DB:.0f}dB SNR"
    )

    embedders = {}
    for key in args.models:
        try:
            embedders[key] = SpeakerEmbedder(CANDIDATES[key], num_threads=args.threads)
        except FileNotFoundError as exc:
            print(f"  {key}: {exc}", file=sys.stderr)
    if not embedders:
        print("no models available; run scripts/download_models.py", file=sys.stderr)
        return EXIT_INCOMPLETE

    # (model, condition, bucket, order) -> unit vector
    vectors: dict[tuple[str, str, float, int], np.ndarray] = {}
    noise_rng = np.random.default_rng(args.seed)
    highest = max(needed)
    processed = 0
    print("\nembedding ...")
    for utterance, samples in iter_rows(args.corpus_dir, with_audio=True):
        if utterance.order in needed:
            assert samples is not None
            for bucket in needed[utterance.order]:
                clipped = truncate_to(samples, bucket, SAMPLE_RATE)
                variants = {
                    "clean": clipped,
                    "far-field": far_field(clipped, rir, noise_rng, snr_db=DEFAULT_SNR_DB),
                }
                for condition, audio in variants.items():
                    for key, embedder in embedders.items():
                        vectors[(key, condition, bucket, utterance.order)] = embedder.embed(
                            audio, sample_rate=SAMPLE_RATE
                        )
            processed += 1
            if processed % 250 == 0:
                # flush=True because this run takes about an hour and stdout is
                # block-buffered when redirected to a file: without it the log
                # stays empty until the process exits, and a stalled run is
                # indistinguishable from a slow one.
                print(f"  {processed}/{len(needed)} utterances", flush=True)
        if utterance.order >= highest:
            break

    pair_rows = []
    summary_rows = []
    cells: dict[tuple[str, str, float], float] = {}
    for bucket, (pairs, stats) in trials_by_bucket.items():
        for condition in CONDITIONS:
            for key in embedders:
                target, nontarget = [], []
                for pair in pairs:
                    left = vectors[(key, condition, bucket, pair.a.order)]
                    right = vectors[(key, condition, bucket, pair.b.order)]
                    score = cosine(left, right)
                    (target if pair.same else nontarget).append(score)
                    pair_rows.append(
                        {
                            "model": key,
                            "condition": condition,
                            "bucket_s": bucket,
                            "same": int(pair.same),
                            "speaker_a": pair.a.speaker,
                            "speaker_b": pair.b.speaker,
                            "order_a": pair.a.order,
                            "order_b": pair.b.order,
                            "index_gap": pair.index_gap,
                            "cosine": f"{score:.6f}",
                        }
                    )
                target_arr = np.asarray(target)
                nontarget_arr = np.asarray(nontarget)
                result = compute_eer(target_arr, nontarget_arr)
                cells[(key, condition, bucket)] = result.eer
                tau_hi = threshold_at_far(nontarget_arr, TAU_HI_FAR)
                tau_lo = threshold_at_frr(target_arr, TAU_LO_FRR)
                summary_rows.append(
                    {
                        "model": key,
                        "condition": condition,
                        "bucket_s": bucket,
                        "eer": f"{result.eer:.6f}",
                        "eer_threshold": f"{result.threshold:.6f}",
                        "tau_hi": f"{tau_hi:.6f}",
                        "tau_lo": f"{tau_lo:.6f}",
                        "dead_zone": f"{tau_hi - tau_lo:.6f}",
                        "target_pairs": len(target),
                        "nontarget_pairs": len(nontarget),
                        "speakers": stats["speakers_contributing_targets"],
                        "verdict": classify(result.eer),
                    }
                )
                _histogram(
                    args.results_dir / "histograms" / f"{key}-{condition}-{bucket:.0f}s.png",
                    target_arr,
                    nontarget_arr,
                    f"{key} / {condition} / {bucket:.0f}s  (EER {result.eer * 100:.1f}%)",
                )

    write_rows(args.results_dir / "pairwise-pairs.csv", pair_rows)
    write_rows(args.results_dir / "pairwise-summary.csv", summary_rows)
    print(f"\nwrote {len(pair_rows)} pair rows and {len(summary_rows)} cells")

    print("\n" + "=" * 74)
    print("CHECKPOINT 1 — pairwise EER screen")
    print("=" * 74)
    print(
        f"gate reads: condition={GATE_CONDITION}, bucket={GATE_BUCKET_S:.0f}s. "
        f"PASS <={PASS_EER:.0%}, KILL >{KILL_EER:.0%}"
    )
    for key in embedders:
        print(f"\n{key}")
        for condition in CONDITIONS:
            line = []
            for bucket in DURATION_BUCKETS_S:
                eer = cells[(key, condition, bucket)]
                line.append(f"{bucket:.0f}s {eer * 100:5.1f}%")
            marker = "  <- GATE" if condition == GATE_CONDITION else ""
            print(f"  {condition:10s} " + "   ".join(line) + marker)

    gate = {
        key: cells[(key, GATE_CONDITION, GATE_BUCKET_S)] for key in embedders
    }
    ranked = sorted(gate.items(), key=lambda item: item[1])
    print("\ngate cell, best first:")
    for key, eer in ranked:
        note = "  (baseline, not a shipping candidate)" if CANDIDATES[key].baseline else ""
        print(f"  {key:13s} {eer * 100:5.1f}%  {classify(eer)}{note}")

    shipping = [(key, eer) for key, eer in ranked if not CANDIDATES[key].baseline]
    if not shipping:
        print("\nINCOMPLETE — no shipping candidate was measured", file=sys.stderr)
        return EXIT_INCOMPLETE

    best_key, best_eer = shipping[0]
    verdict = classify(best_eer)
    print()
    if verdict == "PASS":
        row = next(
            r
            for r in summary_rows
            if r["model"] == best_key
            and r["condition"] == GATE_CONDITION
            and math.isclose(float(r["bucket_s"]), GATE_BUCKET_S)
        )
        print(
            f"PASS — {best_key} at {best_eer * 100:.1f}% EER on the gate cell.\n"
            f"  tau_hi {row['tau_hi']}  tau_lo {row['tau_lo']}  "
            f"dead zone {row['dead_zone']}\n"
            "  Necessary, NOT sufficient: this channel has no browser DSP, and the\n"
            "  far-field room is simulated. Phase 4 produces the acceptance number."
        )
        return 0
    if verdict == "MARGINAL":
        print(
            f"MARGINAL — {best_key} at {best_eer * 100:.1f}% EER, between "
            f"{PASS_EER:.0%} and {KILL_EER:.0%}.\n"
            "  Run the TEN VAD remediation lever before deciding. Note the published\n"
            "  reference: a VoxCeleb-trained model measures 13.19% on Vietnamese at\n"
            "  full length, so MARGINAL is the expected result for an ill-matched\n"
            "  model rather than a near-miss."
        )
        return EXIT_GATE_FAILED
    print(
        f"KILL — best shipping candidate {best_key} at {best_eer * 100:.1f}% EER, "
        f"above {KILL_EER:.0%}.\n"
        "  Do not start Phase 4. Re-open options with the user: named enrollment,\n"
        "  a longer-turn UX, or labels declared explicitly best-effort."
    )
    return EXIT_GATE_FAILED


if __name__ == "__main__":
    raise SystemExit(main())
