"""Phase 7 — how far does the browser's DSP move the numbers?

Every result in this gate was measured on corpus audio that never passed through
`noiseSuppression` or `autoGainControl`. Production enables both
(`apps/web/src/hooks/use-streaming-translate.ts`), and both reshape voice timbre
— which is precisely what a speaker embedding reads. So this sits upstream of
every number the gate reports, including the 87.1% the enrolled mode passed on.

**Diagnostic, never a gate.** It always exits 0. What it can do is invalidate the
thresholds: if the channel moves EER materially, the shipped tau values were
derived on a channel the product does not use and must be re-derived on
channel-matched audio. The gate report then has to say which channel each
threshold came from.

**Read the delta, not the absolute.** One session means one room, one microphone
and same-speaker pairs that share both — the corpus screen went to considerable
trouble to avoid exactly that, so this fixture's absolute EER is optimistic and
not comparable to Checkpoint 1's 23.0%. The two tracks share everything except
the processing, so their difference is the measurement.

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
    SAMPLE_RATE,
    build_channel_pairs,
    load_turn_log,
    turn_samples,
)
from speaker_bench.embed import CANDIDATES, SpeakerEmbedder, cosine  # noqa: E402
from speaker_bench.trials import DURATION_BUCKETS_S, compute_eer, truncate_to  # noqa: E402

TRACKS = ("processed", "control")
MODELS = ("eres2netv2", "campplus")

#: Checkpoint 1's far-field numbers at the same buckets, printed beside this
#: fixture's so a reader can see the scale of the delta against the scale of the
#: problem. NOT a baseline to subtract from — different corpus, different pairing
#: rules, different room.
CORPUS_FAR_FIELD_EER = {
    "eres2netv2": {1.0: 0.274, 2.0: 0.230, 3.0: 0.207},
    "campplus": {1.0: 0.277, 2.0: 0.231, 3.0: 0.227},
}

#: Above this, the thresholds Phase 4 calibrated cannot be trusted on production
#: audio. Chosen against what it would cost to be wrong: the enrolled mode passed
#: with roughly 17 points of headroom over its accuracy bar, and a channel effect
#: at a twentieth of that is not going to overturn it.
MATERIAL_DELTA = 0.05


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


def score_track(
    audio: np.ndarray,
    turns: list,
    embedder: SpeakerEmbedder,
    bucket_s: float,
) -> tuple[float, int, int] | None:
    """EER for one track at one bucket, or None if the fixture cannot fill it."""
    pairs = build_channel_pairs(turns, bucket_s)
    targets = [pair for pair in pairs if pair.same]
    nontargets = [pair for pair in pairs if not pair.same]
    if not targets or not nontargets:
        return None

    wanted = {turn.turn_index: turn for pair in pairs for turn in (pair.a, pair.b)}
    vectors = {
        index: embedder.embed(
            truncate_to(turn_samples(audio, turn), bucket_s, SAMPLE_RATE),
            sample_rate=SAMPLE_RATE,
        )
        for index, turn in wanted.items()
    }
    result = compute_eer(
        np.array([cosine(vectors[p.a.turn_index], vectors[p.b.turn_index]) for p in targets]),
        np.array([cosine(vectors[p.a.turn_index], vectors[p.b.turn_index]) for p in nontargets]),
    )
    return result.eer, len(targets), len(nontargets)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", type=Path, default=BENCH_ROOT / "fixtures")
    parser.add_argument("--session", default="s1")
    parser.add_argument("--out", type=Path, default=BENCH_ROOT / "results" / "channel-delta.csv")
    args = parser.parse_args()

    log_path = args.fixtures / f"{args.session}-turns.json"
    if not log_path.exists():
        print(
            f"no turn log at {log_path}.\n"
            "Record first: node benchmarks/speaker-id/recorder/serve.mjs, then move the three\n"
            "downloaded files into benchmarks/speaker-id/fixtures/.",
            file=sys.stderr,
        )
        return 0  # Diagnostic: an absent fixture is UNMEASURED, not a failure.

    payload, turns = load_turn_log(log_path)
    audio = {track: read_wav(args.fixtures / f"{args.session}-{track}.wav") for track in TRACKS}
    speakers = sorted({turn.speaker_id for turn in turns})
    print(
        f"session {args.session}: {len(turns)} turns, {len(speakers)} speakers, "
        f"{len(audio['processed']) / SAMPLE_RATE:.0f}s per track",
        flush=True,
    )
    print(f"reported settings: {payload.get('settingsReported')}\n", flush=True)

    rows = []
    for model in MODELS:
        embedder = SpeakerEmbedder(CANDIDATES[model], num_threads=4)
        for bucket in DURATION_BUCKETS_S:
            scored = {track: score_track(audio[track], turns, embedder, bucket) for track in TRACKS}
            if any(value is None for value in scored.values()):
                print(f"  {model:12s} {bucket:.0f}s  too few pairs at this bucket", flush=True)
                continue
            processed_eer, targets, nontargets = scored["processed"]
            control_eer, _, _ = scored["control"]
            delta = processed_eer - control_eer
            rows.append({
                "model": model, "bucket_s": bucket,
                "processed_eer": f"{processed_eer:.6f}",
                "control_eer": f"{control_eer:.6f}",
                "delta": f"{delta:.6f}",
                "corpus_far_field_eer": f"{CORPUS_FAR_FIELD_EER[model][bucket]:.3f}",
                "target_pairs": targets, "nontarget_pairs": nontargets,
                "speakers": len(speakers),
            })
            print(
                f"  {model:12s} {bucket:.0f}s  processed {processed_eer * 100:5.1f}%  "
                f"control {control_eer * 100:5.1f}%  delta {delta * 100:+5.1f}pt   "
                f"(corpus far-field was {CORPUS_FAR_FIELD_EER[model][bucket] * 100:.1f}%)",
                flush=True,
            )

    if not rows:
        print("\nnothing scorable in this fixture; channel delta UNMEASURED", flush=True)
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nwrote {args.out}", flush=True)

    gate = [row for row in rows if float(row["bucket_s"]) == 2.0]
    worst = max(gate, key=lambda row: float(row["delta"])) if gate else max(
        rows, key=lambda row: float(row["delta"])
    )
    delta = float(worst["delta"])
    print("=" * 78, flush=True)
    if delta > MATERIAL_DELTA:
        print(
            f"CHANNEL DELTA IS MATERIAL: {delta * 100:+.1f} points at the 2s bucket "
            f"({worst['model']}).\n"
            "Production's DSP moves what the embeddings see, so every tau calibrated on corpus\n"
            "audio was calibrated on a channel the product does not use. Re-derive the shipped\n"
            "thresholds on channel-matched audio, and record in the gate report which channel\n"
            "each number came from.",
            flush=True,
        )
    else:
        print(
            f"CHANNEL DELTA IS SMALL: {delta * 100:+.1f} points at the 2s bucket "
            f"({worst['model']}).\n"
            "The corpus-calibrated thresholds survive the browser channel on this fixture. Note\n"
            "this is one room and one microphone -- it bounds the effect, it does not retire it.",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
