"""Pooled Whisper-base encoder states for every turn and prefix of a manifest.

    cd services/local-stt && uv run --frozen python \\
        ../../benchmarks/lid/arms/whisper_head/dump_features.py \\
        --manifest ../../benchmarks/lid/results/<tag>/manifest.jsonl --out ../../benchmarks/lid/data/features/<tag>.npz

Runs inside the SIDECAR's environment and through the sidecar's own code
(`services/local-stt/lid/`): the pinned ONNX weights it serves, its numpy
log-mel, its turn-length encoder window with the 5 s floor. The features are
therefore exactly what the sidecar computes on every decision today -- it
reads one decoder token from them and throws the rest away. Nothing is pulled
from the Hub, so this needs none of the `lidbench` isolation.

Per (turn, prefix): the mean and the standard deviation of the encoder output
over the frames that hold the clip (Whisper's zero padding is left out), and
the decoder's three language-token log-probabilities, which is what
`whisper_probs_base_ctx5` scored. Writes one `.npz` (ids, prefix_ms, X);
`data/` is ignored, the features are re-creatable.
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
SIDECAR = BENCH_ROOT.parents[1] / "services" / "local-stt"
sys.path.insert(0, str(SIDECAR))

from lid.log_mel import RATE, log_mel  # noqa: E402
from lid.model_decider import LANGUAGES, WhisperLanguageId, window_samples  # noqa: E402

#: The prefixes the bake-off scores partials at (`run_bakeoff.py`).
PREFIXES_MS = (600, 900, 1200, 1500, 2000, 3000)
#: Encoder output frames per second: 100 mel frames/s, halved by the conv stride.
FRAMES_PER_S = 50


def read_pcm16(path: Path) -> np.ndarray:
    with wave.open(str(path)) as fh:
        if fh.getframerate() != RATE or fh.getnchannels() != 1 or fh.getsampwidth() != 2:
            raise ValueError(f"{path}: expected 16 kHz mono PCM16")
        return np.frombuffer(fh.readframes(fh.getnframes()), dtype="<i2").astype(np.float32) / 32768.0


class EncoderFeatures:
    """The sidecar's loaded identifier, asked for its hidden states as well."""

    def __init__(self) -> None:
        self.lid = WhisperLanguageId()
        self.lid.load()

    def __call__(self, samples: np.ndarray) -> np.ndarray:
        mel = log_mel(samples, window_samples(len(samples)))
        hidden = self.lid._encoder.run(None, {"input_features": mel})[0]
        logits = self.lid._decoder.run(
            None, {"input_ids": np.array([[self.lid._sot]], dtype=np.int64), "encoder_hidden_states": hidden},
        )[0][0, -1]
        frames = hidden[0, : max(1, min(hidden.shape[1], -(-len(samples) * FRAMES_PER_S // RATE)))]
        picked = np.array([logits[self.lid._ids[lang]] for lang in LANGUAGES], dtype=np.float64)
        log_probs = picked - picked.max() - np.log(np.exp(picked - picked.max()).sum())
        return np.concatenate([frames.mean(axis=0), frames.std(axis=0), log_probs]).astype(np.float32)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=0, help="first N turns only (a smoke run)")
    args = parser.parse_args()

    # Noise turns too: A5 asks how sure the arm is on them.
    rows = [json.loads(line) for line in args.manifest.read_text().splitlines() if line.strip()]
    if args.limit:
        rows = rows[: args.limit]
    features = EncoderFeatures()
    ids, prefixes, vectors = [], [], []
    started = time.perf_counter()
    for i, row in enumerate(rows):
        samples = read_pcm16(BENCH_ROOT / row["audio"])
        clips = [(-1, samples)] + [(ms, samples[: ms * RATE // 1000]) for ms in PREFIXES_MS
                                   if ms * RATE // 1000 < len(samples)]
        for prefix_ms, clip in clips:
            ids.append(row["id"])
            prefixes.append(prefix_ms)
            vectors.append(features(clip))
        if (i + 1) % 500 == 0:
            print(f"{i + 1}/{len(rows)} turns, {time.perf_counter() - started:.0f} s", flush=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    # prefix_ms -1 is the whole turn (npz has no None).
    np.savez_compressed(args.out, ids=np.array(ids), prefix_ms=np.array(prefixes, dtype=np.int32),
                        X=np.stack(vectors), languages=np.array(LANGUAGES))
    print(f"wrote {len(ids)} vectors of {vectors[0].size} for {len(rows)} turns to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
