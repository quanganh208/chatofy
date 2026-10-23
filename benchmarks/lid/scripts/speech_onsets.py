"""Where speech starts in each replayed turn's clip, for timing A6 from it.

    uv run --frozen python scripts/speech_onsets.py

A6's bar is "from the start of speech", but `replay_sessions.mjs` can only
time from the start of the clip it plays, and the clips carry their own lead-in
silence (p50 ~190 ms, p95 ~540 ms, up to 6 s on the conversational manifest).
Timed from the clip, the label looked 200-450 ms late at p95. This writes each
turn's first speech onset, found by the same Silero VAD the STT sidecar loads,
next to the manifest as `onsets.json`; `score_replay.py` subtracts it.
"""

from __future__ import annotations

import argparse
import json
import sys
import wave
from pathlib import Path

import numpy as np
import sherpa_onnx

BENCH_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MANIFEST = BENCH_ROOT / "results" / "conv-r4-ctx5" / "manifest.jsonl"
DEFAULT_VAD = BENCH_ROOT.parent.parent / "services" / "local-stt" / "models" / "silero_vad.onnx"
RATE = 16000


def detector(model: Path) -> sherpa_onnx.VoiceActivityDetector:
    config = sherpa_onnx.VadModelConfig()
    config.silero_vad.model = str(model)
    config.silero_vad.min_silence_duration = 0.25
    config.silero_vad.min_speech_duration = 0.1
    config.sample_rate = RATE
    return sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=120)


def onset_ms(path: Path, model: Path) -> int | None:
    with wave.open(str(path)) as clip:
        if clip.getframerate() != RATE or clip.getnchannels() != 1:
            raise SystemExit(f"{path}: expected 16 kHz mono")
        samples = np.frombuffer(clip.readframes(clip.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    vad = detector(model)
    for start in range(0, len(samples), 512):
        vad.accept_waveform(samples[start:start + 512])
    vad.flush()
    return None if vad.empty() else round(vad.front.start * 1000 / RATE)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--vad", type=Path, default=DEFAULT_VAD)
    args = parser.parse_args()
    turns = [json.loads(line) for line in args.manifest.read_text().splitlines() if line.strip()]
    onsets = {t["id"]: onset_ms(BENCH_ROOT / t["audio"], args.vad) for t in turns if not t.get("noise")}
    out = args.manifest.parent / "onsets.json"
    out.write_text(json.dumps(onsets, indent=0, sort_keys=True) + "\n")
    print(f"{len(onsets)} onsets -> {out.relative_to(BENCH_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
