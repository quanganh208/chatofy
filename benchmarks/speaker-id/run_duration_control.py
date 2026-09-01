"""M11 — does audio length move the EER once the trial population is held fixed?

The published EER-vs-duration curve in `results/pairwise-summary-screen.csv` is
flat where the literature for this model class is steep: campplus/clean reads
21.22% / 20.50% / 20.49% across 1s / 2s / 3s. Either the corpus and protocol set
a real ceiling near 20%, or trial construction is dominated by something that
swamps duration — and those two demand opposite responses from the whole
programme.

**The published curve cannot separate them, because its populations differ.**
`pairs.py` admits a speaker to a bucket only when a clip is at least that long,
so the three cells above were measured over 80, 76 and 74 contributing speakers.
More speakers means more confusable pairs, so a duration effect and a population
effect are superimposed and neither can be read off.

This script removes the confound rather than arguing about it. One trial list is
built at the long bucket, and **those same pairs, those same clips, those same
speakers** are scored twice: truncated to the long length, and truncated to the
short one. Nothing else varies. Whatever difference remains is duration.

The statistic is the ratio of the two EERs, because the claim being tested is a
ratio claim. The bars are `RATIO_SOUND` and `RATIO_SUSPECT` below, and they were
fixed before the run rather than chosen after seeing it — which is the only thing
that makes a reading of them worth anything. This script prints its reading
against them and decides nothing.

Run (on the host that holds the corpus):
    uv run python run_duration_control.py
"""

from __future__ import annotations

import argparse
import random
import sys
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
from speaker_bench.trials import compute_eer, truncate_to  # noqa: E402

SAMPLE_RATE = 16_000

#: Reported as separate cells, never pooled. Clean is the diagnostic one: clean
#: is where the published curve is flat. Far-field is reported beside it and is
#: NOT independent evidence — one shared RIR across every clip inflates
#: non-target cosines, so its duration slope is confounded (plan correction C2).
CONDITIONS = ("clean", "far-field")

#: Durations every cell is scored at, longest first. The longest fixes the
#: population; every other is a truncation of those same clips.
#:
#: **8.0s** is an 8x lever against the published curve's 3x while retaining 48 of
#: the 1.0s cell's 80 contributing speakers, and it is the length published
#: evaluations of this model class report against. Chosen from the index before
#: the first run, on population cost, and recorded in the pre-registration.
#:
#: **3.0s** was added after the first run, and only for comparability: the claim
#: under test is "published curves move 2-4x across 1-3s", and a ratio measured
#: across 1-8s cannot be held against it. It changes no bar. The primary
#: statistic is still the full span.
#:
#: **1.0s** is the product's measured turn length, and the cell every session
#: number in this plan was read at.
DURATIONS_S = (8.0, 3.0, 1.0)

#: The span published curves are quoted over, reported beside the primary
#: statistic when both ends are present.
LITERATURE_SPAN_S = (3.0, 1.0)

#: Pre-registered readings of `EER(short) / EER(long)` on the clean cell.
RATIO_SOUND = 2.0
RATIO_SUSPECT = 1.25

#: Restricted vs unrestricted 1.0s clean EER may differ by at most this, in
#: absolute points, before the published curve is a population artifact.
POPULATION_TOLERANCE = 0.02

#: The recorded unrestricted 1.0s clean cell this run is compared against.
#: `results/pairwise-summary-screen.csv`, campplus, clean, bucket 1.0.
RECORDED_UNRESTRICTED_1S_EER = 0.2122

EXIT_INCOMPLETE = 3


def _noise_rng(seed: int, order: int, seconds: float) -> np.random.Generator:
    """One generator per (clip, duration), so the arms share no draw order.

    A single sequential generator would make the far-field noise a clip receives
    depend on how many clips were processed before it, which differs between the
    two duration arms. That is a difference the comparison must not carry.
    """
    return np.random.default_rng([seed, order, int(round(seconds * 1000))])


def read_verdict(ratio: float) -> str:
    """Apply the pre-registered ratio bars. Extracted so it is testable."""
    if ratio >= RATIO_SOUND:
        return "SOUND"
    if ratio <= RATIO_SUSPECT:
        return "SUSPECT"
    return "UNDETERMINED"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-dir", type=Path, default=DEFAULT_CORPUS_DIR)
    parser.add_argument("--index", type=Path, default=BENCH_ROOT / "corpora" / "voxvietnam-index.csv")
    parser.add_argument("--results-dir", type=Path, default=BENCH_ROOT / "results")
    parser.add_argument("--model", default="campplus")
    parser.add_argument(
        "--durations", nargs="+", type=float, default=list(DURATIONS_S),
        help="seconds each cell is scored at; the longest fixes the population",
    )
    parser.add_argument("--max-pairs-per-speaker", type=int, default=MAX_PAIRS_PER_SPEAKER)
    parser.add_argument("--min-index-gap", type=int, default=MIN_INDEX_GAP)
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--seed", type=int, default=20260824)
    parser.add_argument("--dry-run", action="store_true", help="report trial sizes, then stop")
    args = parser.parse_args()

    durations = tuple(sorted(set(args.durations), reverse=True))
    if len(durations) < 2:
        print("--durations needs at least two distinct lengths", file=sys.stderr)
        return EXIT_INCOMPLETE
    args.long_s, args.short_s = durations[0], durations[-1]

    index = load_index(args.index)

    # The population is fixed by the LONG bucket. Every clip in it is at least
    # `long_s`, so it can be truncated to either arm without padding — which is
    # what makes one pair list serve both.
    pairs, stats = build_trials(
        index,
        args.long_s,
        random.Random(args.seed),
        min_index_gap=args.min_index_gap,
        max_per_speaker=args.max_pairs_per_speaker,
    )
    print(
        f"fixed population at {args.long_s:.1f}s: "
        f"{stats['target_pairs']} same + {stats['nontarget_pairs']} diff pairs, "
        f"{stats['speakers_contributing_targets']}/{stats['speakers_eligible']} speakers"
    )
    print(
        "scored at " + ", ".join(f"{s:.1f}s" for s in durations) + " over the SAME pairs"
    )

    needed = {pair.a.order for pair in pairs} | {pair.b.order for pair in pairs}
    print(
        f"\n{len(needed)} distinct utterances, "
        f"{len(needed) * len(durations) * len(CONDITIONS)} embeddings to compute"
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

    try:
        embedder = SpeakerEmbedder(CANDIDATES[args.model], num_threads=args.threads)
    except (KeyError, FileNotFoundError) as exc:
        print(f"{args.model}: {exc}", file=sys.stderr)
        return EXIT_INCOMPLETE

    # (condition, duration, order) -> unit vector
    vectors: dict[tuple[str, float, int], np.ndarray] = {}
    highest = max(needed)
    processed = 0
    print("\nembedding ...", flush=True)
    for utterance, samples in iter_rows(args.corpus_dir, with_audio=True):
        if utterance.order in needed:
            assert samples is not None
            for seconds in durations:
                clipped = truncate_to(samples, seconds, SAMPLE_RATE)
                variants = {
                    "clean": clipped,
                    "far-field": far_field(
                        clipped,
                        rir,
                        _noise_rng(args.seed, utterance.order, seconds),
                        snr_db=DEFAULT_SNR_DB,
                    ),
                }
                for condition, audio in variants.items():
                    vectors[(condition, seconds, utterance.order)] = embedder.embed(
                        audio, sample_rate=SAMPLE_RATE
                    )
            processed += 1
            if processed % 100 == 0:
                # flush because stdout is block-buffered when redirected, and a
                # stalled hour-long run must not look like a slow one.
                print(f"  {processed}/{len(needed)} utterances", flush=True)
        if utterance.order >= highest:
            break

    pair_rows: list[dict] = []
    summary_rows: list[dict] = []
    eer_by_cell: dict[tuple[str, float], float] = {}
    for condition in CONDITIONS:
        for seconds in durations:
            same_scores, diff_scores = [], []
            for pair in pairs:
                score = cosine(
                    vectors[(condition, seconds, pair.a.order)],
                    vectors[(condition, seconds, pair.b.order)],
                )
                (same_scores if pair.same else diff_scores).append(score)
                pair_rows.append(
                    {
                        "model": args.model,
                        "condition": condition,
                        "bucket_s": seconds,
                        "population_s": args.long_s,
                        "same": int(pair.same),
                        "speaker_a": pair.a.speaker,
                        "speaker_b": pair.b.speaker,
                        "order_a": pair.a.order,
                        "order_b": pair.b.order,
                        "index_gap": pair.index_gap,
                        "cosine": f"{score:.6f}",
                    }
                )
            same_arr = np.asarray(same_scores)
            diff_arr = np.asarray(diff_scores)
            result = compute_eer(same_arr, diff_arr)
            eer_by_cell[(condition, seconds)] = result.eer
            summary_rows.append(
                {
                    "model": args.model,
                    "licence": CANDIDATES[args.model].licence,
                    "corpus": CANDIDATES[args.model].corpus,
                    "condition": condition,
                    "bucket_s": seconds,
                    # The population every cell here shares, so a reader cannot
                    # mistake these for the published per-bucket cells.
                    "population_s": args.long_s,
                    "eer": f"{result.eer:.6f}",
                    "eer_threshold": f"{result.threshold:.6f}",
                    "target_pairs": len(same_scores),
                    "nontarget_pairs": len(diff_scores),
                    "speakers": stats["speakers_contributing_targets"],
                    "speakers_eligible": stats["speakers_eligible"],
                }
            )

    write_rows(args.results_dir / "m11-duration-control-pairs.csv", pair_rows)
    write_rows(args.results_dir / "m11-duration-control.csv", summary_rows)
    print(f"\nwrote {len(pair_rows)} pair rows and {len(summary_rows)} cells")

    print("\n" + "=" * 74)
    print("M11 — duration control on a fixed trial population")
    print("=" * 74)
    print(
        f"population: {stats['speakers_contributing_targets']} speakers, "
        f"{stats['target_pairs']} same + {stats['nontarget_pairs']} diff pairs, "
        f"identical in every cell below"
    )
    for condition in CONDITIONS:
        cells = "   ".join(
            f"{s:.1f}s {eer_by_cell[(condition, s)] * 100:6.2f}%" for s in durations
        )
        long_eer = eer_by_cell[(condition, args.long_s)]
        short_eer = eer_by_cell[(condition, args.short_s)]
        ratio = short_eer / long_eer if long_eer > 0 else float("inf")
        note = "" if condition == "clean" else "   (confounded by the shared RIR — C2)"
        print(f"\n  {condition:10s} {cells}   ratio {ratio:5.2f}x{note}")

    clean_long = eer_by_cell[("clean", args.long_s)]
    clean_short = eer_by_cell[("clean", args.short_s)]
    ratio = clean_short / clean_long if clean_long > 0 else float("inf")
    verdict = read_verdict(ratio)

    drift = abs(clean_short - RECORDED_UNRESTRICTED_1S_EER)
    print(
        f"\npopulation check: restricted {args.short_s:.1f}s clean "
        f"{clean_short * 100:.2f}% vs recorded unrestricted "
        f"{RECORDED_UNRESTRICTED_1S_EER * 100:.2f}% "
        f"-> {drift * 100:.2f}pt apart (tolerance {POPULATION_TOLERANCE * 100:.0f}pt)"
    )
    if drift > POPULATION_TOLERANCE:
        print(
            "  POPULATION ARTIFACT — the published curve was driven by its changing\n"
            "  speaker set, not by the instrument. Fix trial construction and re-run\n"
            "  before reading anything else in this phase."
        )

    print(
        f"\nprimary statistic: R = {ratio:.2f}x  (clean, same pairs, "
        f"{args.short_s:.1f}s -> {args.long_s:.1f}s)"
    )
    span_long, span_short = LITERATURE_SPAN_S
    if {span_long, span_short} <= set(durations):
        # The published claim is quoted over 1-3s, so a ratio measured over a
        # wider span cannot be held against it without this line.
        span_ratio = eer_by_cell[("clean", span_short)] / eer_by_cell[("clean", span_long)]
        print(
            f"literature span:   {span_ratio:.2f}x  (clean, "
            f"{span_short:.1f}s -> {span_long:.1f}s; published curves for this "
            "model class are quoted at 2-4x here)"
        )
    if clean_long < 0.10:
        print(
            f"absolute anchor MET — restricted {args.long_s:.1f}s clean EER "
            f"{clean_long * 100:.2f}% is single digit.\n"
            "  The instrument is measuring identity regardless of what R reads."
        )
    if verdict == "SOUND":
        print(
            f"\nSOUND — R >= {RATIO_SOUND:.2f}. Duration is a first-order effect once the\n"
            "  population is held fixed, so the flat published curve was a bucket-range\n"
            "  artifact. Phase 1's verdict stands. Proceed to M12-M14, then Phase 2."
        )
    elif verdict == "SUSPECT":
        print(
            f"\nSUSPECT — R <= {RATIO_SUSPECT:.2f}. An "
            f"{args.long_s / args.short_s:.0f}x duration change barely moves EER on a\n"
            "  fixed population. STOP THE SLICE. Do not schedule Phase 2. Requote every\n"
            "  number in this plan as conditional; Phase 1's FAIL is void with them."
        )
    else:
        print(
            f"\nUNDETERMINED — R sits between {RATIO_SUSPECT:.2f} and {RATIO_SOUND:.2f}.\n"
            "  Pre-registered response is to report and escalate, not to pick a branch."
        )
    print(
        "\nEvidence limit (constraint 13): this reads "
        f"{stats['speakers_contributing_targets']} contributing speakers of one "
        "Vietnamese corpus,\n  with a synthetic far-field channel and no browser DSP anywhere."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
