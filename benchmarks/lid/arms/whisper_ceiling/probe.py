"""Accuracy-only ceiling probe: a bigger Whisper through the sidecar's own path.

    cd services/local-stt && uv run --frozen python \\
        ../../benchmarks/lid/arms/whisper_ceiling/probe.py --size medium \\
        --manifest ../../benchmarks/lid/results/<tag>/manifest.jsonl --out ../../benchmarks/lid/results/<tag>

Asks whether a larger model knows short Mandarin turns that Whisper-base gets
wrong, before anything is spent on shipping one. Same mechanism as the
sidecar (`services/local-stt/lid/`): its numpy log-mel and the language
token's probabilities at the first decoder step. The weights are the size's
pinned onnx-community export (`arms/whisper_probs/pins.json`, fetched and
hashed by `lid_bench.pinned`), and the window is Whisper's native 30 s: the
medium export fixes 1500 positions in every attention reshape, so
`arms/whisper_probs/window.py` cannot cut it to the turn. Its baseline is
therefore `whisper_probs_base` (30 s), not the shipped `base_ctx5`.

Whole turns only, no prefixes: this answers "is the signal there", not "can it
lock in time". Writes `whisper_probs_<size>.scores.jsonl` and a meta that
says it is a probe (`ceiling_probe: true`), which `score.py` never loads as an
arm. Write it to a tag of its own: the file name is the scored Whisper arm's.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
BENCH_ROOT = HERE.parents[1]
SIDECAR = BENCH_ROOT.parents[1] / "services" / "local-stt"
sys.path.insert(0, str(SIDECAR))

from lid.log_mel import MAX_SAMPLES, RATE, log_mel  # noqa: E402
from lid.model_decider import LANGUAGES, SOT  # noqa: E402

PINS = json.loads((BENCH_ROOT / "arms" / "whisper_probs" / "pins.json").read_text())
MODELS = BENCH_ROOT / "models"


def read_pcm16(path: Path) -> np.ndarray:
    with wave.open(str(path)) as fh:
        if fh.getframerate() != RATE or fh.getnchannels() != 1 or fh.getsampwidth() != 2:
            raise ValueError(f"{path}: expected 16 kHz mono PCM16")
        return np.frombuffer(fh.readframes(fh.getnframes()), dtype="<i2").astype(np.float32) / 32768.0


class Whisper30s:
    def __init__(self, snapshot: Path, threads: int) -> None:
        import onnxruntime as ort

        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        self.encoder = ort.InferenceSession(str(snapshot / "onnx" / "encoder_model.onnx"), options)
        self.decoder = ort.InferenceSession(str(snapshot / "onnx" / "decoder_model.onnx"), options)
        vocab = {t["content"]: t["id"] for t in json.loads((snapshot / "tokenizer.json").read_text())["added_tokens"]}
        self.sot = vocab[SOT]
        self.ids = {lang: vocab[f"<|{lang}|>"] for lang in LANGUAGES}

    def __call__(self, samples: np.ndarray) -> dict[str, float]:
        hidden = self.encoder.run(None, {"input_features": log_mel(samples, MAX_SAMPLES)})[0]
        logits = self.decoder.run(None, {"input_ids": np.array([[self.sot]], dtype=np.int64),
                                         "encoder_hidden_states": hidden})[0][0, -1]
        picked = np.array([logits[self.ids[lang]] for lang in LANGUAGES], dtype=np.float64)
        picked = np.exp(picked - picked.max())
        return dict(zip(LANGUAGES, (picked / picked.sum()).tolist()))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--size", required=True, choices=sorted(PINS))
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--ids", type=Path, help="score only the turn ids listed one per line in this file")
    args = parser.parse_args()

    pin = PINS[args.size]["runtime"]
    snapshot = MODELS / pin["repo"].replace("/", "--") / pin["revision"]
    model = Whisper30s(snapshot, int(os.environ.get("LOCAL_STT_THREADS", "4")))
    rows = [json.loads(line) for line in args.manifest.read_text().splitlines() if line.strip()]
    if args.ids:
        wanted = set(args.ids.read_text().split())
        rows = [r for r in rows if r["id"] in wanted]
    arm = f"whisper_probs_{args.size}"
    key = "+".join(sorted(LANGUAGES))
    latencies = []
    started = time.perf_counter()
    with (args.out / f"{arm}.scores.jsonl").open("w") as fh:
        for i, row in enumerate(rows):
            samples = read_pcm16(BENCH_ROOT / row["audio"])
            t0 = time.perf_counter()
            probs = model(samples)
            latencies.append((time.perf_counter() - t0) * 1000)
            fh.write(json.dumps({"id": row["id"], "prefix_ms": None, "probs": {key: probs},
                                 "latency_ms": round(latencies[-1], 2)}) + "\n")
            if (i + 1) % 250 == 0:
                print(f"{i + 1}/{len(rows)} turns, {time.perf_counter() - started:.0f} s", flush=True)
    meta = {"arm": arm, "kind": "lid-model", "runtime": "onnxruntime-1.27.0", "ceiling_probe": True,
            "needs_gpu": False, "needs_torch": False, "new_model": True,
            "latency_p95_ms": round(float(np.percentile(latencies, 95)), 1),
            "notes": [f"onnx-community whisper-{args.size}@{pin['revision'][:8]} through the sidecar's log-mel, "
                      "30 s window; whole turns only, accuracy probe, not a gate candidate"]}
    (args.out / f"{arm}.meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"wrote {len(rows)} turns; latency p95 {meta['latency_p95_ms']} ms")
    return 0


if __name__ == "__main__":
    sys.exit(main())
