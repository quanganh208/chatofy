"""M11b — score this harness against a number somebody else published.

Every EER in this repository is self-referential. That is why M11 could hold
17.15% EER on eight seconds of clean audio and still not say whether the
instrument was working: there was nothing to check it against.

The exact checkpoint under test publishes **1.16% EER on VoxCeleb1-O** on its own
ModelScope card, and Oxford's official trial list for that set is still served
ungated. So the harness can be run on somebody else's audio, against somebody
else's pairs, and compared to somebody else's number.

**Three arms, because there are three suspects and they fail independently.**

* **A** — the official 37,611-pair list, full utterance. Our embedder and our
  `compute_eer`, with our pair construction bypassed entirely. If this does not
  land near 1.16%, the fault is in the embedding or the scoring and every number
  in the plan is void.
* **A1** — the same official pairs truncated to 1.0s. Not a pass/fail: it is the
  reference value for M11's duration ratio, measured on a corpus where this model
  is known to work.
* **B** — our own `build_trials` construction over the same speakers and the same
  audio. Read against A, this is the only clean measurement of whether the
  pairing rules in `pairs.py` inflate EER.

The bars are `REPRODUCTION_TOLERANCE`, `REPRODUCTION_FAILURE`,
`PAIRING_TOLERANCE` and `PAIRING_FAILURE` below, fixed before the run rather than
chosen after seeing it — which is the only thing that makes a reading of them
worth anything. This script prints its reading against them; it decides nothing.

Run:
    uv run python run_known_good_control.py
"""

from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

BENCH_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BENCH_ROOT))

from speaker_bench.corpus import Utterance  # noqa: E402
from speaker_bench.embed import CANDIDATES, SpeakerEmbedder, cosine  # noqa: E402
from speaker_bench.io import write_rows  # noqa: E402
from speaker_bench.pairs import MAX_PAIRS_PER_SPEAKER, MIN_INDEX_GAP, build_trials  # noqa: E402
from speaker_bench.trials import compute_eer, load_trials, truncate_to  # noqa: E402

SAMPLE_RATE = 16_000

#: What the model's own card reports for this corpus, so the comparison travels
#: with the code rather than living in a report.
PUBLISHED_EER = 0.0116

#: Arm A reproduces the published number within this many absolute points.
REPRODUCTION_TOLERANCE = 0.010
#: At or above this, arm A has failed to reproduce it at all.
REPRODUCTION_FAILURE = 0.050

#: Arm B agrees with arm A within this many absolute points.
PAIRING_TOLERANCE = 0.020
#: At or above this gap, our pair construction is inflating EER.
PAIRING_FAILURE = 0.050

#: The short arm, matching the length every session number in the plan was read
#: at, so `EER(A1)/EER(A)` is comparable to M11's R.
SHORT_S = 1.0

EXIT_INCOMPLETE = 3


def _speaker_of(relative_path: str) -> str:
    """VoxCeleb encodes the speaker in the first path component (`id10270/...`)."""
    return relative_path.split("/", 1)[0]


def _load(path: Path) -> np.ndarray:
    """One clip as mono float32 at the rate the extractor expects.

    Raises rather than resampling. A silent rate conversion here would be a
    second thing the control is unknowingly measuring, and the point of the
    control is that it measures one thing.
    """
    samples, rate = sf.read(path, dtype="float32", always_2d=False)
    if rate != SAMPLE_RATE:
        raise ValueError(f"{path} is {rate}Hz; this corpus is documented as {SAMPLE_RATE}Hz")
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    return np.ascontiguousarray(samples, dtype=np.float32)


def _embed_all(
    embedder: SpeakerEmbedder,
    root: Path,
    relative_paths: list[str],
    seconds: float | None,
) -> dict[str, np.ndarray]:
    """Embed each clip once, at full length or truncated.

    A clip shorter than `seconds` is dropped rather than padded, and the caller
    is told how many went — padding would hand the extractor silence to score as
    speech, and dropping silently would move the population without saying so.
    """
    vectors: dict[str, np.ndarray] = {}
    short = 0
    for done, relative in enumerate(relative_paths, start=1):
        samples = _load(root / relative)
        if seconds is not None:
            if len(samples) < int(round(seconds * SAMPLE_RATE)):
                short += 1
                continue
            samples = truncate_to(samples, seconds, SAMPLE_RATE)
        vectors[relative] = embedder.embed(samples, sample_rate=SAMPLE_RATE)
        if done % 500 == 0:
            print(f"  {done}/{len(relative_paths)} embedded", flush=True)
    if short:
        print(f"  {short} clips shorter than {seconds}s were dropped, not padded", flush=True)
    return vectors


def _score_official(
    trials, vectors: dict[str, np.ndarray], arm: str, seconds: float | None
) -> tuple[float, list[dict], int, int]:
    """Cosine over the official pairs, skipping any whose audio was dropped."""
    same, different, rows = [], [], []
    for trial in trials:
        left = vectors.get(trial.path_a)
        right = vectors.get(trial.path_b)
        if left is None or right is None:
            continue
        score = cosine(left, right)
        (same if trial.same else different).append(score)
        rows.append(
            {
                "arm": arm,
                "bucket_s": "full" if seconds is None else f"{seconds:.1f}",
                "same": int(trial.same),
                "speaker_a": _speaker_of(trial.path_a),
                "speaker_b": _speaker_of(trial.path_b),
                "path_a": trial.path_a,
                "path_b": trial.path_b,
                "cosine": f"{score:.6f}",
            }
        )
    result = compute_eer(np.asarray(same), np.asarray(different))
    return result.eer, rows, len(same), len(different)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--corpus-dir", type=Path, default=BENCH_ROOT / "corpora" / "voxceleb1"
    )
    parser.add_argument("--results-dir", type=Path, default=BENCH_ROOT / "results")
    parser.add_argument("--model", default="campplus")
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--seed", type=int, default=20260824)
    parser.add_argument("--short-s", type=float, default=SHORT_S)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    root = args.corpus_dir / "wav"
    trial_path = args.corpus_dir / "veri_test2.txt"
    if not root.is_dir() or not trial_path.is_file():
        print(f"expected {root} and {trial_path}", file=sys.stderr)
        return EXIT_INCOMPLETE

    trials = load_trials(trial_path)
    referenced = sorted({trial.path_a for trial in trials} | {trial.path_b for trial in trials})
    speakers = {_speaker_of(path) for path in referenced}
    print(
        f"official list: {len(trials)} pairs "
        f"({sum(1 for t in trials if t.same)} same), "
        f"{len(referenced)} clips, {len(speakers)} speakers"
    )
    if args.dry_run:
        print("\n--dry-run: stopping before embedding")
        return 0

    try:
        embedder = SpeakerEmbedder(CANDIDATES[args.model], num_threads=args.threads)
    except (KeyError, FileNotFoundError) as exc:
        print(f"{args.model}: {exc}", file=sys.stderr)
        return EXIT_INCOMPLETE

    pair_rows: list[dict] = []
    summary_rows: list[dict] = []

    print("\narm A — official pairs, full utterance", flush=True)
    full = _embed_all(embedder, root, referenced, None)
    eer_a, rows, same_a, diff_a = _score_official(trials, full, "A", None)
    pair_rows += rows
    summary_rows.append(
        {
            "arm": "A",
            "pairs": "official",
            "bucket_s": "full",
            "eer": f"{eer_a:.6f}",
            "target_pairs": same_a,
            "nontarget_pairs": diff_a,
            "speakers": len(speakers),
        }
    )

    print(f"\narm A1 — official pairs, truncated to {args.short_s:.1f}s", flush=True)
    short = _embed_all(embedder, root, referenced, args.short_s)
    eer_a1, rows, same_a1, diff_a1 = _score_official(trials, short, "A1", args.short_s)
    pair_rows += rows
    summary_rows.append(
        {
            "arm": "A1",
            "pairs": "official",
            "bucket_s": f"{args.short_s:.1f}",
            "eer": f"{eer_a1:.6f}",
            "target_pairs": same_a1,
            "nontarget_pairs": diff_a1,
            "speakers": len(speakers),
        }
    )

    # Arm B. `build_trials` wants an index it can apply its own rules to, and its
    # gap rule reads `order` as a stand-in for session identity. Sorting the
    # relative paths puts one speaker's clips from one video adjacent, which is
    # exactly the adjacency the rule was measured to defend against — so scan
    # order carries the same meaning here as it does on the Vietnamese corpus.
    print("\narm B — our own pair construction, full utterance", flush=True)
    index = [
        Utterance(
            speaker=_speaker_of(relative),
            shard=0,
            row=order,
            order=order,
            # Real duration, so the bucket rule admits the same clips it would
            # admit anywhere else. Read from the header, not decoded.
            duration_s=sf.info(root / relative).duration,
        )
        for order, relative in enumerate(referenced)
    ]
    by_order = {order: relative for order, relative in enumerate(referenced)}
    ours, stats = build_trials(
        index,
        # The shortest clip in the set, so every clip is eligible and arm B
        # differs from arm A only in which pairs it draws — not in which audio.
        min(utterance.duration_s for utterance in index),
        random.Random(args.seed),
        min_index_gap=MIN_INDEX_GAP,
        max_per_speaker=MAX_PAIRS_PER_SPEAKER,
    )
    same, different = [], []
    for pair in ours:
        left = full[by_order[pair.a.order]]
        right = full[by_order[pair.b.order]]
        score = cosine(left, right)
        (same if pair.same else different).append(score)
        pair_rows.append(
            {
                "arm": "B",
                "bucket_s": "full",
                "same": int(pair.same),
                "speaker_a": pair.a.speaker,
                "speaker_b": pair.b.speaker,
                "path_a": by_order[pair.a.order],
                "path_b": by_order[pair.b.order],
                "cosine": f"{score:.6f}",
            }
        )
    eer_b = compute_eer(np.asarray(same), np.asarray(different)).eer
    summary_rows.append(
        {
            "arm": "B",
            "pairs": "ours",
            "bucket_s": "full",
            "eer": f"{eer_b:.6f}",
            "target_pairs": len(same),
            "nontarget_pairs": len(different),
            "speakers": stats["speakers_contributing_targets"],
        }
    )

    write_rows(args.results_dir / "m11b-known-good-pairs.csv", pair_rows)
    write_rows(args.results_dir / "m11b-known-good.csv", summary_rows)
    print(f"\nwrote {len(pair_rows)} pair rows and {len(summary_rows)} cells")

    print("\n" + "=" * 74)
    print("M11b — the known-good control")
    print("=" * 74)
    print(f"published for this exact checkpoint on VoxCeleb1-O: {PUBLISHED_EER * 100:.2f}% EER\n")
    print(f"  A   official pairs, full        {eer_a * 100:6.2f}%   ({same_a} same, {diff_a} diff)")
    print(f"  A1  official pairs, {args.short_s:.1f}s       {eer_a1 * 100:6.2f}%   "
          f"({same_a1} same, {diff_a1} diff)")
    print(f"  B   our pairs, full             {eer_b * 100:6.2f}%   "
          f"({len(same)} same, {len(different)} diff, "
          f"{stats['speakers_contributing_targets']} speakers)")

    drift = abs(eer_a - PUBLISHED_EER)
    print(f"\narm A vs published: {drift * 100:.2f}pt apart")
    if eer_a >= REPRODUCTION_FAILURE:
        print(
            f"  APPARATUS BROKEN — arm A at {eer_a * 100:.2f}% cannot reproduce a published\n"
            "  number on the published list. Every number in this plan is void, P1's FAIL\n"
            "  included. Repairing the embedding or scoring path is the next phase.\n"
            "  Do not read arm B."
        )
        return 0
    if drift > REPRODUCTION_TOLERANCE:
        print(
            "  DEGRADED — reproduces the published number only loosely. Find the cause\n"
            "  (resampling? loader? clip selection?) before reading arm B."
        )
        return 0
    print("  APPARATUS SOUND — the embedder and the EER routine reproduce a published result.")

    gap = eer_b - eer_a
    print(f"\narm B vs arm A: {gap * 100:+.2f}pt on identical audio")
    if gap >= PAIRING_FAILURE:
        print(
            "  PAIR CONSTRUCTION BROKEN — our rules inflate EER where the official list\n"
            "  does not. OQ11 closes SUSPECT: stop the slice, repair pairs.py, re-run\n"
            "  every Vietnamese number."
        )
    elif gap <= PAIRING_TOLERANCE:
        print(
            "  PAIR CONSTRUCTION SOUND — our rules agree with the official list.\n"
            "  OQ11 closes SOUND: the Vietnamese ~17% is a domain gap, not an artifact.\n"
            "  Phase 1's FAIL stands. Proceed to M12-M14, then Phase 2."
        )
    else:
        print(
            f"  PARTIAL — our construction inflates EER by {gap * 100:.2f}pt. Requote every\n"
            "  Vietnamese number with that offset stated."
        )

    ratio = eer_a1 / eer_a if eer_a > 0 else float("inf")
    print(
        f"\nduration ratio on a corpus that works: R_voxceleb = {ratio:.2f}x "
        f"({args.short_s:.1f}s / full)"
    )
    print(
        "  Compare against M11's R = 1.40x on Vietnamese. A large ratio here means the\n"
        "  harness does resolve the duration axis and the Vietnamese flatness is\n"
        "  Vietnamese; a similar ~1.4x means the harness compresses it everywhere and\n"
        "  M11's R was never interpretable."
    )
    print(
        f"\nEvidence limit (constraint 13): {len(speakers)} speakers, English, studio-"
        "adjacent\n  interview audio. It says what the harness does, not what the product does."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
