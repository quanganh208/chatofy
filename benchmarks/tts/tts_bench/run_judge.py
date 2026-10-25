"""Transcribe a set of WAV directories with ONE judge, in its own process.

    uv run python -m tts_bench.run_judge --judge sensevoice-zh \
        --wav-dir results/zh-r1/wav/kokoro-v1_0-en-zh/sid47 ... \
        --out results/zh-r1/judge/sensevoice-zh.jsonl

One row per WAV: {wav, judge, hypothesis}. The orchestrator wraps this process
in the shared CPU lock, so every judge decode is serialized against the other
benchmark jobs on the host.
"""

import argparse
import json
import sys
from pathlib import Path

from .asr_judges import build_recognizer, decode_params, transcribe


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--judge", required=True)
    parser.add_argument("--wav-dir", required=True, type=Path, action="append")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    recognizer = build_recognizer(args.judge)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(json.dumps({"type": "header", "judge": args.judge,
                            "decode_params": decode_params(args.judge)}) + "\n")
        for wav_dir in args.wav_dir:
            wavs = sorted(wav_dir.glob("*.wav"))
            if not wavs:
                raise FileNotFoundError(f"no WAVs in {wav_dir}")
            for wav in wavs:
                f.write(json.dumps({"type": "hyp", "wav": str(wav), "judge": args.judge,
                                    "hypothesis": transcribe(recognizer, wav)},
                                   ensure_ascii=False) + "\n")
                n += 1
    print(f"[{args.judge}] {n} WAVs -> {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
