"""Read every forced cut of a recording the way the block path will.

Input in `<dir>`, one set per recording:
  <conv>.pcm         16 kHz mono int16
  <conv>.turns.json  output of benchmarks/speaker-id/edge-replay/replay-turns.mts
  <conv>.json        Scribe answer, read by score.mts

Output: `<dir>/seams-<lang>.jsonl`, one row per recording with the per-turn
transcripts and one entry per forced cut. `score.mts` applies the shipped
function to those rows, so nothing here reimplements the repair.

Runs its own recognizer. Never point this at a live sidecar: a sweep is what
killed the prod one (see the README).
"""
import argparse
import json
from pathlib import Path

import numpy as np
import sherpa_onnx

RATE = 16000
EDGE_S = 2.5
#: A voice change leaves a short left piece. These widths reproduce that shape.
SHORT_LEFT_S = (0.8, 1.4, 2.0)
#: The client's cut is contiguous unless the gate re-opened on a later word.
MAX_GAP_MS = 400


def recognizer(lang: str, models: Path, threads: int):
    if lang == "en":
        d = models / "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"
        return sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=str(d / "encoder.int8.onnx"),
            decoder=str(d / "decoder.int8.onnx"),
            joiner=str(d / "joiner.int8.onnx"),
            tokens=str(d / "tokens.txt"),
            num_threads=threads,
            model_type="nemo_transducer",
        )
    d = models / "zipformer-vi-30m"
    return sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(d / "encoder-epoch-20-avg-10.int8.onnx"),
        decoder=str(d / "decoder-epoch-20-avg-10.int8.onnx"),
        joiner=str(d / "joiner-epoch-20-avg-10.int8.onnx"),
        tokens=str(d / "tokens.txt"),
        num_threads=threads,
        decoding_method="greedy_search",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True, type=Path)
    parser.add_argument("--models", required=True, type=Path)
    parser.add_argument("--lang", required=True, choices=["en", "vi"])
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("convs", nargs="+")
    args = parser.parse_args()
    rec = recognizer(args.lang, args.models, args.threads)

    def read(samples: np.ndarray) -> str:
        stream = rec.create_stream()
        stream.accept_waveform(RATE, samples.astype(np.float32))
        rec.decode_stream(stream)
        return stream.result.text.strip()

    rows = []
    for conv in args.convs:
        audio = np.fromfile(args.dir / f"{conv}.pcm", dtype="<i2").astype(np.float32) / 32768
        turns = json.loads((args.dir / f"{conv}.turns.json").read_text())
        clip = lambda t: audio[int(t["startMs"] * RATE / 1000) : int(t["endMs"] * RATE / 1000)]  # noqa: E731
        texts = [read(clip(t)) for t in turns]
        seams = []
        edge = int(EDGE_S * RATE)
        for i, turn in enumerate(turns[:-1]):
            after = turns[i + 1]
            if turn["reason"] != "forced" or after["startMs"] - turn["endMs"] >= MAX_GAP_MS:
                continue
            a, b = clip(turn), clip(after)
            shorts = []
            for width in SHORT_LEFT_S:
                piece = a[-int(width * RATE) :]
                shorts.append(
                    {
                        "width": width,
                        "left": read(piece),
                        "clip": read(np.concatenate([piece, b[:edge]])),
                    }
                )
            seams.append(
                {
                    "turn": i,
                    "cutMs": turn["endMs"],
                    "clip": read(np.concatenate([a[-edge:], b[:edge]])),
                    "shorts": shorts,
                }
            )
        rows.append({"conv": conv, "texts": texts, "seams": seams})
        print(conv, len(turns), "turns", len(seams), "seams", flush=True)
    out = args.dir / f"seams-{args.lang}.jsonl"
    out.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows))


if __name__ == "__main__":
    main()
