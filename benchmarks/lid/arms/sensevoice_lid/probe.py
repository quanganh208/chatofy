"""Accuracy-only probe: SenseVoice-Small's language tag as an en/zh voter.

    cd services/local-stt && uv run --frozen python \\
        ../../benchmarks/lid/arms/sensevoice_lid/probe.py \\
        --manifest ../../benchmarks/lid/results/<tag>/manifest.jsonl --ids <ids.txt> --out <dir>

SenseVoice-Small (FunAudioLLM, FunASR model licence: use with attribution)
predicts a language token before it transcribes. The bench already holds its
int8 sherpa-onnx release for the zh STT comparison
(`benchmarks/stt/models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17`),
and the sidecar's env already pins sherpa-onnx, so nothing new is installed.

The question is narrow: the turns Whisper-base and its fusions still get wrong
are short en heard as zh and short zh heard as en. SenseVoice knows zh, en, ja,
ko and yue, and no Vietnamese, so it can only ever arbitrate between en and
zh. sherpa-onnx exposes the argmax tag only (`result.lang`), not its
probabilities: this is a hard voter. Decoding runs the whole model, so the
latency recorded is that of transcribing the turn, an upper bound on reading
the tag alone.

Writes `<out>/sensevoice_lid.jsonl`: one row per turn, `{id, lang, tag,
latency_ms}`, where `tag` is the raw token and `lang` is "en", "zh" (yue
folded in) or "other". A ceiling probe: never loaded as a gate arm.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
BENCH_ROOT = HERE.parents[1]
MODEL_DIR = BENCH_ROOT.parent / "stt" / "models" / "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"
TAGS = {"<|en|>": "en", "<|zh|>": "zh", "<|yue|>": "zh"}


def read_pcm16(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path)) as fh:
        if fh.getnchannels() != 1 or fh.getsampwidth() != 2:
            raise ValueError(f"{path}: expected mono PCM16")
        pcm = np.frombuffer(fh.readframes(fh.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
        return pcm, fh.getframerate()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--ids", type=Path, help="score only the turn ids listed one per line in this file")
    parser.add_argument("--threads", type=int, default=2)
    args = parser.parse_args()

    import sherpa_onnx

    recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(MODEL_DIR / "model.int8.onnx"), tokens=str(MODEL_DIR / "tokens.txt"),
        num_threads=args.threads, language="auto", use_itn=False)
    rows = [json.loads(line) for line in args.manifest.read_text().splitlines()]
    if args.ids:
        wanted = set(args.ids.read_text().split())
        rows = [r for r in rows if r["id"] in wanted]
    args.out.mkdir(parents=True, exist_ok=True)
    root = args.manifest.resolve().parent
    with (args.out / "sensevoice_lid.jsonl").open("w") as fh:
        for i, row in enumerate(rows):
            audio = next(p for p in (BENCH_ROOT / row["audio"], root / row["audio"]) if p.exists())
            samples, rate = read_pcm16(audio)
            start = time.perf_counter()
            stream = recognizer.create_stream()
            stream.accept_waveform(rate, samples)
            recognizer.decode_stream(stream)
            latency = (time.perf_counter() - start) * 1000
            tag = stream.result.lang
            fh.write(json.dumps({"id": row["id"], "lang": TAGS.get(tag, "other"), "tag": tag,
                                 "latency_ms": round(latency, 2)}) + "\n")
            if i % 200 == 0:
                print(f"{i}/{len(rows)}", flush=True)
    print(f"wrote {len(rows)} rows to {args.out / 'sensevoice_lid.jsonl'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
