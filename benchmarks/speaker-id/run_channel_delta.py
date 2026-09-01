"""Phase 2 — how far does the browser's DSP move the numbers?

Every result in this gate was measured on corpus audio that never passed through
`noiseSuppression` or `autoGainControl`. Production enables both
(`apps/web/src/lib/open-microphone.ts:57-61`), and both reshape voice timbre —
which is precisely what a speaker embedding reads. So this sits upstream of every
number the gate reports.

**This is a gate, and it exits like one.** An earlier version of this file
described itself as "diagnostic, never a gate" and returned 0 from every path,
including the one where the fixture is missing. Phase 2 calls itself a hard gate,
so a mis-pathed session used to produce a clean exit and an empty report that
reads as "no delta detected" — the failure mode that looks most like success. The
exit codes now separate the three outcomes that matter:

* ``0`` — PASS or PROCEED. A delta was measured and it does not stop delivery.
* ``1`` — STOP. The channel moved EER past the band; the delivery halts.
* ``2`` — UNMEASURED. No fixture, or nothing scorable in it. Not a pass.

**Read the delta, not the absolute.** One session means one room, one microphone
and same-speaker pairs that share both — the corpus screen went to considerable
trouble to avoid exactly that, so this fixture's absolute EER is optimistic and
not comparable to Checkpoint 1's 23.0%. The two tracks share everything except
the processing, so their difference is the measurement.

**And gate on the worst speaker, not the pooled number.** Pairs drawn from three
to five speakers are not independent observations; the effective sample is three
to five voices. A pooled delta can sit comfortably inside the band while one
participant's voice is destroyed by the channel, because the other speakers'
pairs outnumber theirs. The leave-one-speaker-out spread below shows that, and
the verdict reads the worst of it.

Run, after recording with `recorder/index.html`:
    uv run --directory benchmarks/speaker-id python run_channel_delta.py \\
        --fixtures fixtures --session s1
"""

from __future__ import annotations

import argparse
import csv
import sys
import wave
from pathlib import Path

import numpy as np

BENCH_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BENCH_ROOT))

from speaker_bench.channel import (  # noqa: E402
    MIN_TURN_GAP,
    SAMPLE_RATE,
    Turn,
    build_channel_pairs,
    eligible_turns,
    load_turn_log,
    turn_samples,
)
from speaker_bench.embed import CANDIDATES, SpeakerEmbedder, cosine  # noqa: E402
from speaker_bench.trials import DURATION_BUCKETS_S, compute_eer, truncate_to  # noqa: E402

TRACKS = ("processed", "control")
MODELS = ("eres2netv2", "campplus")

#: The model the verdict is read from.
#:
#: Phase 5 closed the "add a model" axis and campplus stays. `eres2netv2` is
#: still measured and still written to the CSV, because a second model is how you
#: tell a channel effect from a model quirk — but it must not be able to STOP a
#: delivery that does not ship it. Taking the max across both models would let an
#: outlier in the model nobody uses kill the feature on a session that cannot be
#: re-run.
SHIPPING_MODEL = "campplus"

#: Fewest pairs on each side for a leave-one-out cell to be gate-eligible.
#:
#: An EER over N target pairs moves in steps of 1/N, and a delta is a difference
#: of two of them. The narrowest band here is 3 points wide, so a cell whose
#: quantum is a meaningful fraction of that cannot distinguish PASS from PROCEED
#: — and the gate reads the MAX over cells, which is exactly where a coarse,
#: noisy cell lands. At 100 pairs the quantum is 1 point, a third of the
#: narrowest band. A real session clears this comfortably: leaving one speaker
#: out of three still leaves ~1500 same-speaker pairs. What it excludes is the
#: degenerate cell that `_eer_over` would otherwise score from a single pair and
#: return ±1.0 for, which reads as an automatic STOP.
MIN_LOO_PAIRS = 100

#: How far the two tracks may drift apart before the fixture is unusable.
#:
#: Three downsampled blocks (341 samples each at 48 kHz in, 16 kHz out), so about
#: 64ms. Generous enough that a track starting a block or two late is still
#: scored, tight enough that it stays far below the 1.0s gate bucket.
MAX_TRACK_SKEW_SAMPLES = 341 * 3

#: Checkpoint 1's far-field numbers at the same buckets, printed beside this
#: fixture's so a reader can see the scale of the delta against the scale of the
#: problem. NOT a baseline to subtract from — different corpus, different pairing
#: rules, different room.
CORPUS_FAR_FIELD_EER = {
    "eres2netv2": {1.0: 0.274, 2.0: 0.230, 3.0: 0.207},
    "campplus": {1.0: 0.277, 2.0: 0.231, 3.0: 0.227},
}

#: The bucket the verdict is read at, tracking P1-M1's measured turn length.
#:
#: **Not 2.0.** The previous version selected `bucket_s == 2.0` with a silent
#: fallback to the worst bucket overall, which meant that the moment M1 moved
#: `TURN_S` off 2.0 — the entire point of running M1 — the gate was computed on
#: a bucket nobody chose, most likely the harshest one. M1 measured 1.0s, so the
#: gate reads 1.0s. Overridable with `--gate-bucket` for a re-read at another
#: length; the default is the product's.
GATE_BUCKET_S = 1.0

#: The band, replacing a bare `MATERIAL_DELTA = 0.05`.
#:
#: The plan and the script used to disagree: the plan carried a three-way
#: 3/6-point band and the script printed a binary verdict against a single 5-point
#: constant, so the artifact and the plan would have said different things to
#: anybody reading them six weeks later. The band lives here now, and the plan
#: cites this file.
#:
#: * ≤ +3.0 points — PASS, the corpus calibration stands.
#: * +3.0 to +6.0  — PROCEED with bars widened; Phase 6 is the sole ship authority.
#: * > +6.0 points — STOP the delivery.
DELTA_PASS_MAX = 0.03
DELTA_STOP_MIN = 0.06

EXIT_OK = 0
EXIT_STOP = 1
EXIT_UNMEASURED = 2


def read_wav(path: Path) -> np.ndarray:
    """One mono 16 kHz track as float32 in -1..1."""
    with wave.open(str(path), "rb") as handle:
        if handle.getnchannels() != 1:
            raise ValueError(f"{path.name} has {handle.getnchannels()} channels, expected mono")
        if handle.getframerate() != SAMPLE_RATE:
            raise ValueError(f"{path.name} is {handle.getframerate()} Hz, expected {SAMPLE_RATE}")
        if handle.getsampwidth() != 2:
            raise ValueError(f"{path.name} is not 16-bit PCM")
        raw = handle.readframes(handle.getnframes())
    return (np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0).copy()


def embed_turns(
    audio: np.ndarray,
    turns: list[Turn],
    embedder: SpeakerEmbedder,
    bucket_s: float,
) -> dict[int, np.ndarray]:
    """One vector per eligible turn, truncated to the bucket.

    Computed once per (model, bucket, track) and shared by the EER, the top-1
    and the leave-one-out passes — they are three readings of the same
    embeddings, and re-embedding for each would be three times the cost for
    identical vectors.
    """
    return {
        turn.turn_index: embedder.embed(
            truncate_to(turn_samples(audio, turn), bucket_s, SAMPLE_RATE),
            sample_rate=SAMPLE_RATE,
        )
        for turn in eligible_turns(turns, bucket_s)
    }


def _eer_over(pairs: list, vectors: dict[int, np.ndarray]) -> float | None:
    """EER over a pair list, or None when one side of it is empty."""
    targets = [pair for pair in pairs if pair.same]
    nontargets = [pair for pair in pairs if not pair.same]
    if not targets or not nontargets:
        return None
    score = lambda pair: cosine(  # noqa: E731
        vectors[pair.a.turn_index], vectors[pair.b.turn_index]
    )
    return compute_eer(
        np.array([score(pair) for pair in targets]),
        np.array([score(pair) for pair in nontargets]),
    ).eer


def target_mean_cosine(pairs: list, vectors: dict[int, np.ndarray]) -> float:
    """Mean cosine over same-speaker pairs.

    The quantity a channel effect shows up in first and most directly. EER can
    hold steady while every same-speaker score slides down together, because a
    threshold sweep follows the scores; this does not move unless the voices
    themselves got harder to match. Reported as a LOSS at the call site
    (control minus processed), so a positive number always means the DSP hurt.
    """
    same = [pair for pair in pairs if pair.same]
    if not same:
        return float("nan")
    return float(
        np.mean([cosine(vectors[p.a.turn_index], vectors[p.b.turn_index]) for p in same])
    )


def top1_matches(
    turns: list[Turn],
    vectors: dict[int, np.ndarray],
    *,
    min_turn_gap: int = MIN_TURN_GAP,
) -> list[dict]:
    """Nearest-neighbour identification, one row per scorable probe.

    Closer to what the product does than EER is: attribution picks the nearest
    existing voice, it does not sweep a threshold. A channel that leaves EER
    alone but reorders who is nearest would pass the EER gate and break the
    feature.

    The gallery excludes every turn within `min_turn_gap` of the probe —
    **both** speakers, not just the probe's own. Keeping a same-speaker
    neighbour from one moment earlier would let a probe match itself through
    one shared gain state and score a hit the product would never get; dropping
    only those would leave the different-speaker neighbours in and quietly make
    the task harder on one side only. A probe with no same-speaker candidate
    left is not scored at all, because it has no right answer to find.

    **Note the asymmetry with `build_channel_pairs`, which KEEPS its adjacent
    different-speaker pairs.** Both choices are right for what they measure and
    they are not interchangeable. EER is read where two rate curves cross, so
    keeping the hardest non-targets there is conservative — one more hard pair
    can only move the threshold the difficult way. Top-1 is a single argmax, so
    one adjacent neighbour does not make the task harder, it decides the answer.

    **Consequence: the absolute `processed_top1` / `control_top1` are optimistic
    and are not product numbers.** The product compares a new turn against every
    prior turn, including the one immediately before it — which is exactly the
    case this gallery removes. Quote the DELTA, which is what this gate measures
    and which is unaffected: the probe set and the gallery are built from speaker
    ids and turn indices only, so both tracks are handed an identical task.
    """
    rows = []
    scorable = [turn for turn in turns if turn.turn_index in vectors]
    for probe in scorable:
        gallery = [
            other
            for other in scorable
            if abs(other.turn_index - probe.turn_index) >= min_turn_gap
        ]
        if not any(other.speaker_id == probe.speaker_id for other in gallery):
            continue
        scored = [
            (cosine(vectors[probe.turn_index], vectors[other.turn_index]), other)
            for other in gallery
        ]
        best_score, best = max(scored, key=lambda item: item[0])
        own = [score for score, other in scored if other.speaker_id == probe.speaker_id]
        rows.append({
            "turn_index": probe.turn_index,
            "speaker_id": probe.speaker_id,
            "distance": probe.distance,
            "language": probe.language,
            "duration_s": f"{probe.duration_s:.3f}",
            "nearest_turn_index": best.turn_index,
            "nearest_speaker_id": best.speaker_id,
            "nearest_cosine": f"{best_score:.6f}",
            "mean_cosine_own_speaker": f"{float(np.mean(own)):.6f}",
            "top1_correct": int(best.speaker_id == probe.speaker_id),
        })
    return rows


def top1_accuracy(rows: list[dict]) -> float:
    """Fraction of probes whose nearest neighbour was the same speaker."""
    if not rows:
        return float("nan")
    return sum(row["top1_correct"] for row in rows) / len(rows)


def leave_one_out_deltas(
    pairs: list,
    vectors_by_track: dict[str, dict[int, np.ndarray]],
    speakers: list[str],
    *,
    min_pairs: int = MIN_LOO_PAIRS,
) -> dict[str, tuple[float, int, int]]:
    """Δ EER recomputed with each speaker's pairs removed, one entry per speaker.

    Keyed by the speaker LEFT OUT, valued `(delta, targets, nontargets)`. With
    three to five voices, one participant whose timbre the DSP mangles can be
    outvoted by the others in a pooled number; this is where that shows.

    **Read the key carefully, because it is easy to read backwards.** A LARGE
    entry is the subset that still looks bad after removing that speaker — so
    the speaker named by the largest entry is the one who was NOT carrying the
    damage. The speaker carrying it is the one whose removal makes the delta
    smallest.

    A cell is dropped rather than returned when either side falls below
    `min_pairs`. The gate takes the maximum over these, which is precisely where
    a cell scored from a handful of pairs would land: `_eer_over` will happily
    return a number from one target and one non-target, quantised to 0 or 1, and
    a spurious ±1.0 in this dict is an automatic STOP on a session nobody can
    record again.
    """
    spread: dict[str, tuple[float, int, int]] = {}
    for held_out in speakers:
        kept = [
            pair
            for pair in pairs
            if pair.a.speaker_id != held_out and pair.b.speaker_id != held_out
        ]
        targets = sum(1 for pair in kept if pair.same)
        nontargets = len(kept) - targets
        if targets < min_pairs or nontargets < min_pairs:
            continue
        processed = _eer_over(kept, vectors_by_track["processed"])
        control = _eer_over(kept, vectors_by_track["control"])
        if processed is None or control is None:
            continue
        spread[held_out] = (processed - control, targets, nontargets)
    return spread


def select_gate_rows(rows: list[dict], bucket_s: float, model: str = SHIPPING_MODEL) -> list[dict]:
    """The rows the verdict may be read from: one bucket, one model, no fallback.

    Extracted so the empty case is reachable by a test. The behaviour it
    replaced fell back to the worst bucket overall whenever the gate bucket
    produced nothing, which meant a bucket nobody chose could deliver a verdict
    — and the emptiness that triggered it is only possible AFTER a session, when
    the turns turn out too short to fill the bucket the gate reads.
    """
    return [
        row
        for row in rows
        if float(row["bucket_s"]) == bucket_s and row["model"] == model
    ]


def verdict_for(delta: float) -> tuple[str, int, str]:
    """The band, as a name, an exit code, and what it means for the delivery."""
    # Both boundaries are inclusive on the friendlier side, matching the plan's
    # "<= +3.0 PASS", "+3.0 to +6.0 PROCEED", "> +6.0 STOP".
    if delta <= DELTA_PASS_MAX:
        return (
            "PASS",
            EXIT_OK,
            "The corpus-calibrated thresholds survive the browser channel on this fixture.\n"
            "This is one room and one microphone -- it bounds the effect, it does not retire it.",
        )
    # `<=`, not `<`. The plan reads "+3.0 to +6.0 -> PROCEED" and "> +6.0 ->
    # STOP", so exactly +6.0 is the top of PROCEED. Reconciling the script with
    # the plan at the boundary was step 1's stated job, and an off-by-one here
    # would have the artifact and the plan disagree on the one value where the
    # delivery either continues or ends.
    if delta <= DELTA_STOP_MIN:
        return (
            "PROCEED, BARS WIDEN",
            EXIT_OK,
            "The channel moves the numbers enough to matter but not enough to stop.\n"
            "Phase 6 is the sole ship authority, and its bars widen by the measured delta.\n"
            "Record in the gate report which channel every shipped threshold came from.",
        )
    return (
        "STOP",
        EXIT_STOP,
        "Production's DSP moves what the embeddings see past the band. Every tau calibrated\n"
        "on corpus audio was calibrated on a channel the product does not use. The delivery\n"
        "stops here: this is a documented outcome, not a retry trigger.",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", type=Path, default=BENCH_ROOT / "fixtures")
    parser.add_argument("--session", default="s1")
    parser.add_argument("--out", type=Path, default=BENCH_ROOT / "results" / "channel-delta.csv")
    parser.add_argument(
        "--per-turn-out",
        type=Path,
        default=BENCH_ROOT / "results" / "channel-delta-turns.csv",
        help="one row per probe per model/bucket/track; the audit trail behind the aggregates",
    )
    parser.add_argument(
        "--gate-bucket",
        type=float,
        default=GATE_BUCKET_S,
        help=f"bucket the verdict reads, in seconds (default {GATE_BUCKET_S}, P1-M1's turn length)",
    )
    args = parser.parse_args()

    default_per_turn = BENCH_ROOT / "results" / "channel-delta-turns.csv"
    if args.per_turn_out != default_per_turn:
        # `.gitignore` names the default path literally, so any other path under
        # `results/` is a tracked file holding one row per turn somebody spoke,
        # from a session recorded under a stated destruction date.
        print(
            f"refusing --per-turn-out {args.per_turn_out}: only {default_per_turn} is "
            "gitignored, and this file carries one row per real turn.",
            file=sys.stderr,
        )
        return EXIT_UNMEASURED

    if args.gate_bucket not in DURATION_BUCKETS_S:
        print(
            f"--gate-bucket {args.gate_bucket} is not one of {DURATION_BUCKETS_S}; "
            "nothing would be scored at it.",
            file=sys.stderr,
        )
        return EXIT_UNMEASURED

    log_path = args.fixtures / f"{args.session}-turns.json"
    if not log_path.exists():
        print(
            f"no turn log at {log_path}.\n"
            "Record first: node benchmarks/speaker-id/recorder/serve.mjs, then move the\n"
            "downloaded files into benchmarks/speaker-id/fixtures/.\n"
            "UNMEASURED is not a pass -- this exits non-zero so a mis-pathed session cannot\n"
            "read as 'no delta detected'.",
            file=sys.stderr,
        )
        return EXIT_UNMEASURED

    missing = [
        path
        for path in (args.fixtures / f"{args.session}-{track}.wav" for track in TRACKS)
        if not path.exists()
    ]
    if missing:
        # Checked beside the log rather than left to `read_wav`, so a fixture
        # that is half-present is UNMEASURED like an absent one instead of
        # raising from inside the scoring loop.
        print(
            "the turn log is here but its audio is not: "
            + ", ".join(path.name for path in missing),
            file=sys.stderr,
        )
        return EXIT_UNMEASURED

    payload, turns = load_turn_log(log_path)
    audio = {track: read_wav(args.fixtures / f"{args.session}-{track}.wav") for track in TRACKS}

    # One turn log indexes BOTH tracks, which is only valid while they are
    # sample-aligned. Each track has its own source node and its own worklet, so
    # one can begin a block or two later than the other -- and then every
    # processed/control comparison is offset against itself, which is the single
    # subtraction this fixture exists to make. A drift of one block is 1024
    # samples at capture rate, 341 downsampled: 21ms, or 2% of the shortest
    # bucket. Anything past a few blocks is not a fixture worth scoring.
    skew = abs(len(audio["processed"]) - len(audio["control"]))
    if skew > MAX_TRACK_SKEW_SAMPLES:
        print(
            f"the two tracks differ by {skew} samples "
            f"({skew / SAMPLE_RATE * 1000:.0f}ms), past the {MAX_TRACK_SKEW_SAMPLES}-sample "
            "tolerance. One turn log cannot index both, so every delta would be a\n"
            "comparison of two different moments. UNMEASURED.",
            file=sys.stderr,
        )
        return EXIT_UNMEASURED
    speakers = sorted({turn.speaker_id for turn in turns})
    languages = sorted({turn.language for turn in turns})
    print(
        f"session {args.session}: {len(turns)} turns, {len(speakers)} speakers, "
        f"{len(audio['processed']) / SAMPLE_RATE:.0f}s per track",
        flush=True,
    )
    print(f"reported settings: {payload.get('settingsReported')}", flush=True)
    print(f"languages labelled: {', '.join(languages)}\n", flush=True)

    rows: list[dict] = []
    per_turn: list[dict] = []
    for model in MODELS:
        embedder = SpeakerEmbedder(CANDIDATES[model], num_threads=4)
        for bucket in DURATION_BUCKETS_S:
            pairs = build_channel_pairs(turns, bucket)
            vectors = {
                track: embed_turns(audio[track], turns, embedder, bucket) for track in TRACKS
            }
            eer = {track: _eer_over(pairs, vectors[track]) for track in TRACKS}
            if eer["processed"] is None or eer["control"] is None:
                print(f"  {model:12s} {bucket:.0f}s  too few pairs at this bucket", flush=True)
                continue

            corpus_reference = CORPUS_FAR_FIELD_EER.get(model, {}).get(bucket)
            matches = {track: top1_matches(turns, vectors[track]) for track in TRACKS}
            for track in TRACKS:
                for row in matches[track]:
                    per_turn.append({"model": model, "bucket_s": bucket, "track": track, **row})

            top1 = {track: top1_accuracy(matches[track]) for track in TRACKS}
            mean_cos = {track: target_mean_cosine(pairs, vectors[track]) for track in TRACKS}
            spread = leave_one_out_deltas(pairs, vectors, speakers)
            deltas = {speaker: value[0] for speaker, value in spread.items()}

            delta = eer["processed"] - eer["control"]
            # Worst = largest, because delta is processed minus control and a
            # positive delta is the channel making things worse.
            #
            # With no eligible leave-one-out cell — two speakers, or every cell
            # below the pair floor — this falls back to the pooled delta. That is
            # the honest reading: with two speakers, removing either leaves no
            # cross-speaker pair at all, so there is no subset to be worse.
            worst_loo = max(deltas.values()) if deltas else delta
            worst_excluded = max(deltas, key=deltas.__getitem__) if deltas else ""
            # The speaker the channel actually hurt: the one whose REMOVAL makes
            # the delta smallest. Reported separately because the column above
            # reads backwards at a glance — the speaker named there is the one
            # whose absence left the damage behind, not the one causing it.
            most_affected = min(deltas, key=deltas.__getitem__) if deltas else ""
            rows.append({
                "model": model,
                "bucket_s": bucket,
                "processed_eer": f"{eer['processed']:.6f}",
                "control_eer": f"{eer['control']:.6f}",
                "delta": f"{delta:.6f}",
                "worst_loo_delta": f"{worst_loo:.6f}",
                "worst_loo_excluded_speaker": worst_excluded,
                "most_affected_speaker": most_affected,
                "loo_cells_eligible": len(spread),
                "processed_top1": f"{top1['processed']:.6f}",
                "control_top1": f"{top1['control']:.6f}",
                "delta_top1": f"{top1['processed'] - top1['control']:.6f}",
                "processed_target_mean_cosine": f"{mean_cos['processed']:.6f}",
                "control_target_mean_cosine": f"{mean_cos['control']:.6f}",
                "target_mean_cosine_loss": f"{mean_cos['control'] - mean_cos['processed']:.6f}",
                # `.get`, not `[...]`. This dict is keyed on the buckets that
                # existed when Checkpoint 1 ran, and `DURATION_BUCKETS_S` is
                # owned by `speaker_bench/trials.py` and shared with
                # `run_pairwise.py` — so a bucket added for another phase raises
                # KeyError here, mid-analysis, on a session that cannot be
                # repeated. An empty cell says "no corpus number at this length",
                # which is true and costs nothing.
                "corpus_far_field_eer": (
                    f"{corpus_reference:.3f}" if corpus_reference is not None else ""
                ),
                "target_pairs": sum(1 for pair in pairs if pair.same),
                "nontarget_pairs": sum(1 for pair in pairs if not pair.same),
                "top1_probes": len(matches["processed"]),
                "speakers": len(speakers),
            })
            print(
                f"  {model:12s} {bucket:.0f}s  processed {eer['processed'] * 100:5.1f}%  "
                f"control {eer['control'] * 100:5.1f}%  delta {delta * 100:+5.1f}pt  "
                f"worst-LOO {worst_loo * 100:+5.1f}pt  "
                f"top1 {top1['processed'] - top1['control']:+.3f}  "
                f"cos-loss {mean_cos['control'] - mean_cos['processed']:+.4f}"
                + ("" if corpus_reference is None else f"   (corpus far-field {corpus_reference * 100:.1f}%)"),
                flush=True,
            )
            if spread:
                detail = "  ".join(
                    f"-{speaker} {value[0] * 100:+.1f} ({value[1]}/{value[2]})"
                    for speaker, value in sorted(spread.items())
                )
                print(f"               leave-one-out: {detail}", flush=True)
            elif len(speakers) > 2:
                print(
                    f"               leave-one-out: no cell reached {MIN_LOO_PAIRS} pairs a side; "
                    "gating on the pooled delta",
                    flush=True,
                )

    if not rows:
        print("\nnothing scorable in this fixture; channel delta UNMEASURED", flush=True)
        return EXIT_UNMEASURED

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nwrote {args.out}", flush=True)

    if per_turn:
        args.per_turn_out.parent.mkdir(parents=True, exist_ok=True)
        with args.per_turn_out.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(per_turn[0]))
            writer.writeheader()
            writer.writerows(per_turn)
        print(f"wrote {args.per_turn_out}", flush=True)

    gate = select_gate_rows(rows, args.gate_bucket)
    if not gate:
        print(
            f"\nnothing scored for {SHIPPING_MODEL} at the {args.gate_bucket:.1f}s gate "
            "bucket; channel delta UNMEASURED at the length the product actually produces.\n"
            "No fallback to another bucket or another model: a verdict read at a length\n"
            "nobody chose, or from a model nobody ships, is not this gate's verdict.",
            file=sys.stderr,
        )
        return EXIT_UNMEASURED

    worst = max(gate, key=lambda row: float(row["worst_loo_delta"]))
    delta = float(worst["worst_loo_delta"])
    name, code, meaning = verdict_for(delta)
    print("=" * 78, flush=True)
    eligible = int(worst["loo_cells_eligible"])
    basis = (
        f"worst of {eligible} leave-one-out subsets, the one with "
        f"{worst['worst_loo_excluded_speaker']} removed"
        if eligible
        else "pooled — no leave-one-out subset was gate-eligible"
    )
    print(
        f"CHANNEL DELTA {name}: {delta * 100:+.1f} points at the "
        f"{args.gate_bucket:.1f}s bucket, {SHIPPING_MODEL} (the shipping model).\n"
        f"Basis: {basis}.\n"
        f"Pooled delta at the same cell was {float(worst['delta']) * 100:+.1f} points"
        + (
            f"; the speaker the channel hurt most was {worst['most_affected_speaker']}.\n"
            if worst["most_affected_speaker"]
            else ".\n"
        )
        + f"Band: PASS <= +{DELTA_PASS_MAX * 100:.0f}pt, PROCEED to "
        f"+{DELTA_STOP_MIN * 100:.0f}pt, STOP above it.\n\n{meaning}",
        flush=True,
    )
    return code


def _guarded_main() -> int:
    """`main`, with operational failure separated from the gate's verdict.

    Without this every uncaught exception exits 1, and this script now DEFINES
    exit 1 as STOP — "the feature dies here: a documented outcome, not a retry
    trigger". A mis-named WAV, a malformed log or a missing model file would
    therefore announce the delivery's most consequential verdict, from a run that
    measured nothing.

    The previous defect was the mirror of this one: everything exited 0, so a
    mis-pathed session read as "no delta detected". Both are the same mistake —
    an operational failure wearing a result's clothes — and fixing one direction
    without the other just moves it.
    """
    try:
        return main()
    except (OSError, ValueError, KeyError) as err:
        print(
            f"the channel gate could not run: {type(err).__name__}: {err}\n"
            "This is UNMEASURED, not a verdict. Nothing about the channel was learned,\n"
            "and in particular this is NOT the STOP that ends the delivery.",
            file=sys.stderr,
        )
        return EXIT_UNMEASURED


if __name__ == "__main__":
    raise SystemExit(_guarded_main())
