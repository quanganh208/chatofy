"""VieNeu-TTS smoke test — verify CPU/ONNX env works and produce one Vietnamese wav.

Measures cold-start model load and single-sentence generation (RTF) so Phase 2's
full benchmark has a known-good baseline to build on.
"""
import time
from pathlib import Path

import numpy as np
from vieneu import Vieneu

OUT_DIR = Path(__file__).parent / "out"
OUT_DIR.mkdir(exist_ok=True)

SENTENCE = "Xin chào, đây là bản dịch tiếng Việt được tổng hợp ngay trên máy tính này."


def main() -> None:
    t0 = time.perf_counter()
    tts = Vieneu(mode="v3turbo")  # CPU -> torch-free ONNX
    load_s = time.perf_counter() - t0
    print(f"[load] cold-start model load: {load_s:.2f}s  backend={getattr(tts, 'backend', '?')}")

    # Discover preset voices (v3 turbo ships built-in speakers).
    voices = list(getattr(tts, "_preset_voices", {}).keys())
    default_voice = getattr(tts, "_default_voice", None)
    print(f"[voices] {len(voices)} presets, default={default_voice!r}")
    print(f"[voices] {voices}")
    voice = default_voice or (voices[0] if voices else None)

    # Warm-up run (first infer pays one-time graph/JIT costs) — not counted.
    _ = tts.infer("Khởi động.", voice=voice)

    t1 = time.perf_counter()
    audio = tts.infer(SENTENCE, voice=voice)
    gen_s = time.perf_counter() - t1

    audio = np.asarray(audio, dtype=np.float32)
    dur_s = len(audio) / tts.sample_rate
    rtf = gen_s / dur_s if dur_s > 0 else float("nan")

    out = OUT_DIR / "smoke_test.wav"
    tts.save(audio, out)

    print(f"[gen ] chars={len(SENTENCE)} audio={dur_s:.2f}s gen={gen_s:.2f}s "
          f"RTF={rtf:.3f} sr={tts.sample_rate} voice={voice!r}")
    print(f"[out ] {out}")


if __name__ == "__main__":
    main()
