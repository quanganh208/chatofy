"""Noisy-WER baseline: how far transcription degrades as noise rises.

Mixes a clean speech corpus with a noise corpus at a sweep of SNRs, transcribes
every arm through the **real** STT sidecar, and reports WER and CER per SNR
against the clean-audio arm as the ceiling. The clean arm is transcribed too, on
purpose: the question is how much noise *adds* to the error, so the baseline the
curve is read against is this engine's own clean WER, not zero.

This is Phase 1 of the noise-suppression work — the ruler, recorded before Phase
2 changes anything. Denoise then has to beat these numbers at low SNR without
hurting the high-SNR arms, and the three-arm APM comparison (plan decision 3)
runs here too: re-run with the browser's `noiseSuppression` on and off in the
clean corpus's own capture to see whether RNNoise should stack on it or replace
it.

    # Needs the STT sidecar up (pnpm dev:all, or just the local-stt container).
    uv run python run_noise_wer.py \
        --manifest data/clean-vi.jsonl \
        --noise-dir data/noise \
        --snrs 20 10 5 0 \
        --out results/baseline

Manifest is one JSON object per line: {"file": "...", "text": "...",
"language": "vi"}, `file` relative to the manifest. Noise is a directory of WAVs
(DEMAND, MUSAN, or a real room recording); each utterance draws one, round-robin,
so the pairing is fixed across runs and a later run is comparable with this one.

Nothing here downloads a corpus or commits audio — the corpora are the user's to
place, exactly as `benchmarks/stt` leaves its datasets to `prepare_datasets.py`.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from noise_bench.mix import load_wav_mono, mix_at_snr, resample_to_16k, save_wav_16k
from noise_bench.transcribe import TranscribeError, sidecar_ready, transcribe_wav

# Reused from the clean STT benchmark so the two sets of numbers are scored
# identically and can be compared directly.
from stt_bench.metrics import corpus_cer, corpus_wer


@dataclass
class Utterance:
    file: Path
    text: str
    language: str


@dataclass
class Arm:
    """One SNR (or the clean control), accumulating ref/hyp pairs across the
    corpus so WER is corpus-level rather than an average of per-utterance rates."""

    label: str
    refs: list[str] = field(default_factory=list)
    hyps: list[str] = field(default_factory=list)
    failures: int = 0


def read_manifest(path: Path) -> list[Utterance]:
    root = path.parent
    utterances: list[Utterance] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        utterances.append(
            Utterance(file=root / row["file"], text=row["text"], language=row["language"])
        )
    if not utterances:
        raise SystemExit(f"{path} has no utterances")
    return utterances


def noise_pool(noise_dir: Path) -> list[Path]:
    pool = sorted(p for p in noise_dir.glob("*.wav"))
    if not pool:
        raise SystemExit(f"no .wav noise files in {noise_dir}")
    return pool


def transcribe_or_note_failure(arm: Arm, wav: Path, utt: Utterance, stt_url: str) -> None:
    """Add the pair to the arm, or count a transport failure without polluting the
    corpus. A transport failure (503, timeout) is not a data point; an empty
    transcript is, and lands as WER 1.0 for that utterance."""
    try:
        hyp = transcribe_wav(wav, utt.language, base_url=stt_url)
    except TranscribeError as err:
        arm.failures += 1
        print(f"  ! {utt.file.name} @ {arm.label}: {err}", file=sys.stderr)
        return
    arm.refs.append(utt.text)
    arm.hyps.append(hyp)


def run(
    utterances: list[Utterance],
    noise_files: list[Path],
    snrs: list[float],
    stt_url: str,
    out_dir: Path,
    tmp_dir: Path,
) -> dict[str, Arm]:
    arms: dict[str, Arm] = {"clean": Arm("clean")}
    for snr in snrs:
        arms[f"{snr:g}dB"] = Arm(f"{snr:g}dB")

    tmp_dir.mkdir(parents=True, exist_ok=True)

    for index, utt in enumerate(utterances):
        clean, rate = load_wav_mono(utt.file)
        clean16 = resample_to_16k(clean, rate)

        clean_wav = tmp_dir / "clean.wav"
        save_wav_16k(clean_wav, clean16)
        transcribe_or_note_failure(arms["clean"], clean_wav, utt, stt_url)

        # Round-robin so the utterance↔noise pairing is deterministic and a
        # re-run lands the same noise under the same sentence.
        noise_path = noise_files[index % len(noise_files)]
        noise, noise_rate = load_wav_mono(noise_path)
        noise16 = resample_to_16k(noise, noise_rate)

        for snr in snrs:
            mixed = mix_at_snr(clean16, noise16, snr, offset=index * 997)
            mixed_wav = tmp_dir / "mixed.wav"
            save_wav_16k(mixed_wav, mixed)
            transcribe_or_note_failure(arms[f"{snr:g}dB"], mixed_wav, utt, stt_url)

        print(f"  {index + 1}/{len(utterances)}  {utt.file.name}")

    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for arm in arms.values():
        scored = len(arm.refs)
        wer = corpus_wer(arm.refs, arm.hyps) if scored else float("nan")
        cer = corpus_cer(arm.refs, arm.hyps) if scored else float("nan")
        rows.append(
            {"arm": arm.label, "wer": wer, "cer": cer, "scored": scored, "failures": arm.failures}
        )
    (out_dir / "wer.jsonl").write_text(
        "".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8"
    )
    return arms


def report(arms: dict[str, Arm]) -> None:
    clean = arms["clean"]
    clean_wer = corpus_wer(clean.refs, clean.hyps) if clean.refs else float("nan")

    print("\n  arm         WER      CER     Δ vs clean   scored  failures")
    for arm in arms.values():
        if not arm.refs:
            print(f"  {arm.label:<10}  —        —              —          0  {arm.failures}")
            continue
        wer = corpus_wer(arm.refs, arm.hyps)
        cer = corpus_cer(arm.refs, arm.hyps)
        delta = "" if arm.label == "clean" else f"{(wer - clean_wer) * 100:+.1f}pp"
        print(
            f"  {arm.label:<10}  {wer * 100:5.1f}%  {cer * 100:5.1f}%  {delta:>10}   "
            f"{len(arm.refs):>6}  {arm.failures}"
        )
    print(
        "\n  Δ is how much noise added to this engine's own clean WER. The curve to\n"
        "  beat in Phase 2: denoise must pull the low-SNR arms down without lifting\n"
        "  the clean arm."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--noise-dir", type=Path, required=True)
    parser.add_argument("--snrs", type=float, nargs="+", default=[20, 10, 5, 0])
    parser.add_argument("--stt-url", default="http://127.0.0.1:8002")
    parser.add_argument("--out", type=Path, default=Path("results/baseline"))
    parser.add_argument("--limit", type=int, default=0, help="first N utterances only")
    args = parser.parse_args()

    if not sidecar_ready(args.stt_url):
        raise SystemExit(
            f"STT sidecar not answering at {args.stt_url}/healthz — start it with "
            "`docker compose up -d --wait local-stt` (or `pnpm dev:all`)."
        )

    utterances = read_manifest(args.manifest)
    if args.limit:
        utterances = utterances[: args.limit]
    noise_files = noise_pool(args.noise_dir)

    print(
        f"{len(utterances)} utterances × ({len(args.snrs)} SNR + clean) "
        f"= {len(utterances) * (len(args.snrs) + 1)} transcriptions through {args.stt_url}"
    )
    arms = run(utterances, noise_files, args.snrs, args.stt_url, args.out, args.out / "tmp")
    report(arms)
    print(f"\nWritten: {args.out / 'wer.jsonl'}")


if __name__ == "__main__":
    main()
