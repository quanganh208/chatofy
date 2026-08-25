"""Does named enrollment survive where per-turn verification died?

Checkpoint 1 killed the design the plan actually specified: unknown-N clustering,
where every turn is compared against every other turn and a threshold decides
"same voice or not". That is open-set verification on 2s of audio, and at 23.0%
EER it does not work for Vietnamese in this channel.

The plan's own kill clause names three options to re-open, and the first is
**named enrollment**: each participant speaks once before the meeting, that audio
becomes a labelled centroid, and every later turn is assigned to the nearest
centroid. Asking the user to choose between that and abandoning the feature
without measuring it would be asking them to guess, because enrollment changes
the task in two ways that both help:

* **Closed-set, not open-set.** The question stops being "are these the same
  person, yes or no" and becomes "which of these N known people is this" — one
  decision among N, with no threshold to calibrate.
* **A centroid, not a single turn.** Averaging several enrollment clips cancels
  much of the per-turn variance that Checkpoint 1 identified as the actual
  killer (same-speaker cosine 0.497 +- 0.212 — right on average, unreliable per
  turn).

**What this measures.** Top-1 identification accuracy over meetings of N
speakers, enrolled from clips that satisfy the same channel-gap rule the gate
used, tested on the same 2s turns from the same corpus and the same simulated
far-field room. Scored two ways:

* at full coverage — every turn is labelled;
* at 80% coverage — the least confident fifth is left unlabelled, which is
  exactly the acceptance shape Phase 4 defines (accuracy-over-attributed with a
  >=80% coverage floor, passing at >=70%).

The 5s bucket runs alongside so the "longer-turn UX" option is measured on the
same axis rather than extrapolated.

**What it does not measure.** Nobody unenrolled ever speaks here, so this is the
closed-set number; a real meeting with a guest needs a rejection threshold, and
that is a further question this probe does not answer. It also inherits every
limitation stated in the Phase 3 results: no browser DSP, simulated far-field,
`segment.py` bypassed, residual same-video channel sharing.

Run:
    uv run --directory benchmarks/speaker-id python scripts/probe_enrollment_identification.py
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

#: Clips averaged into one speaker centroid. Three clips of up to five seconds
#: is roughly the "read this sentence once" enrolment a product could ask for
#: without it feeling like a setup wizard.
ENROLL_CLIPS = 3
ENROLL_MAX_S = 5.0
MIN_ENROLL_S = 2.0

#: Turn lengths scored. 2.0 is the gate cell Checkpoint 1 was read at; 5.0 is
#: the "longer-turn UX" option, measured rather than assumed.
TEST_BUCKETS_S = (2.0, 5.0)

#: Meeting sizes. The contract says 3-5 same-language speakers.
MEETING_SIZES = (3, 5)
MEETINGS_PER_SIZE = 400

#: Test clips kept per speaker. Caps the prolific voices the same way the pair
#: sampler does, so accuracy describes the corpus and not its loudest members.
MAX_TEST_CLIPS = 6

MODELS = ("eres2netv2", "campplus")
CONDITIONS = ("clean", "far-field")

#: Phase 4's acceptance shape, reused here so the numbers are comparable.
COVERAGE_FLOOR = 0.80
ACCURACY_BAR = 0.70


def assign_roles(index, rng: random.Random) -> dict[str, dict]:
    """Split each speaker's clips into an enrolment set and a test set.

    Enrolment takes the earliest qualifying clips and testing takes only clips
    at least :data:`MIN_INDEX_GAP` beyond the last of them. That is the same
    channel-leakage rule the gate used, applied in the direction that matters
    here: a centroid built from the same source recording as the test turn would
    measure the recording, not the speaker.
    """
    by_speaker: dict[str, list] = defaultdict(list)
    for utterance in index:
        by_speaker[utterance.speaker].append(utterance)

    roles: dict[str, dict] = {}
    for speaker, items in by_speaker.items():
        items = sorted(items, key=lambda u: u.order)
        enroll = [u for u in items if u.duration_s >= MIN_ENROLL_S][:ENROLL_CLIPS]
        if len(enroll) < ENROLL_CLIPS:
            continue
        cutoff = enroll[-1].order + MIN_INDEX_GAP
        tests = [u for u in items if u.order >= cutoff]
        if not tests:
            continue
        rng.shuffle(tests)
        roles[speaker] = {"enroll": enroll, "test": tests[:MAX_TEST_CLIPS]}
    return roles


def score_cell(
    centroids: dict[str, np.ndarray],
    tests: dict[str, list[np.ndarray]],
    sizes: tuple[int, ...],
    rng: random.Random,
) -> dict[int, tuple[float, float, int]]:
    """Top-1 accuracy per meeting size, at full and at 80% coverage.

    Confidence is the top-1 cosine itself. Ranking turns by it and dropping the
    least confident fifth is the cheapest possible stand-in for the dead-zone
    mechanism, and it is deliberately cheap: if identification only clears the
    bar under a cleverer confidence measure, that is a different claim and this
    probe should not be the thing that makes it.
    """
    speakers = sorted(centroids)
    results: dict[int, tuple[float, float, int]] = {}
    for size in sizes:
        if len(speakers) < size:
            continue
        correct: list[bool] = []
        confidence: list[float] = []
        for _ in range(MEETINGS_PER_SIZE):
            members = rng.sample(speakers, size)
            bank = np.stack([centroids[name] for name in members])
            for truth in members:
                for vector in tests[truth]:
                    scores = bank @ vector
                    winner = int(np.argmax(scores))
                    correct.append(members[winner] == truth)
                    confidence.append(float(scores[winner]))
        hits = np.asarray(correct)
        order = np.argsort(np.asarray(confidence))[::-1]
        keep = max(1, int(round(COVERAGE_FLOOR * hits.size)))
        results[size] = (
            float(hits.mean()),
            float(hits[order[:keep]].mean()),
            int(hits.size),
        )
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-dir", type=Path, default=DEFAULT_CORPUS_DIR)
    parser.add_argument("--index", type=Path, default=BENCH_ROOT / "corpora" / "voxvietnam-index.csv")
    parser.add_argument("--out", type=Path, default=BENCH_ROOT / "results" / "enrollment-summary.csv")
    parser.add_argument("--seed", type=int, default=20260825)
    args = parser.parse_args()

    index = load_index(args.index)
    roles = assign_roles(index, random.Random(args.seed))
    print(
        f"{len(roles)} speakers enrollable "
        f"({ENROLL_CLIPS} clips <={ENROLL_MAX_S:.0f}s each, test clips >={MIN_INDEX_GAP} rows later)",
        flush=True,
    )

    wanted: dict[int, tuple[str, str]] = {}
    for speaker, split in roles.items():
        for utterance in split["enroll"]:
            wanted[utterance.order] = (speaker, "enroll")
        for utterance in split["test"]:
            wanted[utterance.order] = (speaker, "test")
    print(f"{len(wanted)} clips to read", flush=True)

    room = RoomConfig()
    rir, measured_rt60 = build_rir(room)
    print(f"far-field room: {room.source_distance_m:.2f}m, RT60 {measured_rt60:.3f}s", flush=True)

    embedders = {name: SpeakerEmbedder(CANDIDATES[name], num_threads=4) for name in MODELS}
    noise_rng = np.random.default_rng(args.seed)

    # {(model, condition)-> {speaker: [enrol vectors]}} and per test bucket.
    enroll_vectors: dict[tuple[str, str], dict[str, list[np.ndarray]]] = {
        key: defaultdict(list) for key in ((m, c) for m in MODELS for c in CONDITIONS)
    }
    test_vectors: dict[tuple[str, str, float], dict[str, list[np.ndarray]]] = {
        (m, c, b): defaultdict(list)
        for m in MODELS
        for c in CONDITIONS
        for b in TEST_BUCKETS_S
    }

    highest = max(wanted)
    seen = 0
    for utterance, samples in iter_rows(args.corpus_dir, with_audio=True):
        if utterance.order in wanted:
            assert samples is not None
            speaker, role = wanted[utterance.order]
            seen += 1
            if seen % 100 == 0:
                print(f"  {seen}/{len(wanted)} clips embedded", flush=True)

            if role == "enroll":
                # Slice rather than truncate_to: the helper refuses to pad, and a clip
                # shorter than the enrolment cap is legitimate here.
                clip = samples[: int(ENROLL_MAX_S * SAMPLE_RATE)]
                variants = {
                    "clean": clip,
                    "far-field": far_field(clip, rir, noise_rng, snr_db=DEFAULT_SNR_DB),
                }
                for model in MODELS:
                    for condition, audio in variants.items():
                        enroll_vectors[(model, condition)][speaker].append(
                            embedders[model].embed(audio, sample_rate=SAMPLE_RATE)
                        )
            else:
                for bucket in TEST_BUCKETS_S:
                    if utterance.duration_s < bucket:
                        continue
                    clip = truncate_to(samples, bucket, SAMPLE_RATE)
                    variants = {
                        "clean": clip,
                        "far-field": far_field(clip, rir, noise_rng, snr_db=DEFAULT_SNR_DB),
                    }
                    for model in MODELS:
                        for condition, audio in variants.items():
                            test_vectors[(model, condition, bucket)][speaker].append(
                                embedders[model].embed(audio, sample_rate=SAMPLE_RATE)
                            )
        if utterance.order >= highest:
            break

    args.out.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    print(flush=True)
    for model in MODELS:
        for condition in CONDITIONS:
            centroids = {}
            for speaker, vectors in enroll_vectors[(model, condition)].items():
                mean = np.mean(np.stack(vectors), axis=0)
                centroids[speaker] = (mean / np.linalg.norm(mean)).astype(np.float32)
            for bucket in TEST_BUCKETS_S:
                tests = {
                    speaker: vectors
                    for speaker, vectors in test_vectors[(model, condition, bucket)].items()
                    if speaker in centroids and vectors
                }
                if len(tests) < min(MEETING_SIZES):
                    continue
                scored = score_cell(
                    {s: centroids[s] for s in tests}, tests, MEETING_SIZES, random.Random(args.seed)
                )
                for size, (full, covered, turns) in scored.items():
                    verdict = "PASS" if covered >= ACCURACY_BAR else "FAIL"
                    rows.append(
                        {
                            "model": model,
                            "condition": condition,
                            "test_bucket_s": bucket,
                            "meeting_size": size,
                            "top1_accuracy": f"{full:.6f}",
                            "accuracy_at_80pct_coverage": f"{covered:.6f}",
                            "chance": f"{1 / size:.6f}",
                            "turns_scored": turns,
                            "speakers": len(tests),
                            "verdict": verdict,
                        }
                    )
                    print(
                        f"{model:12s} {condition:10s} {bucket:.0f}s  N={size}  "
                        f"top-1 {full * 100:5.1f}%   @80% cov {covered * 100:5.1f}%   "
                        f"(chance {100 / size:4.1f}%)  {verdict}",
                        flush=True,
                    )

    with args.out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nwrote {args.out}", flush=True)

    gate = [
        row
        for row in rows
        if row["condition"] == "far-field"
        and float(row["test_bucket_s"]) == 2.0
        and int(row["meeting_size"]) == 5
    ]
    print("=" * 78, flush=True)
    if gate and max(float(row["accuracy_at_80pct_coverage"]) for row in gate) >= ACCURACY_BAR:
        best = max(gate, key=lambda row: float(row["accuracy_at_80pct_coverage"]))
        print(
            f"ENROLMENT CLEARS PHASE 4'S BAR on the hardest cell: {best['model']} at "
            f"{float(best['accuracy_at_80pct_coverage']) * 100:.1f}% over the most confident 80%\n"
            "of 2s far-field turns in a 5-speaker meeting. The feature is not dead; what is dead\n"
            "is the threshold-clustering design that tried to do it without enrolment.",
            flush=True,
        )
    else:
        print(
            "ENROLMENT DOES NOT CLEAR THE BAR EITHER on 2s far-field turns with 5 speakers.\n"
            "Read the longer buckets and smaller meetings before concluding: the failure may be\n"
            "specific to short turns or to crowded meetings rather than to enrolment itself.",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
