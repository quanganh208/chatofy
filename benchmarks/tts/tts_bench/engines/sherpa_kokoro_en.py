"""Kokoro-82M English (Apache-2.0) via sherpa-onnx OfflineTts.

k2-fsa package kokoro-en-v0_19: model.onnx + voices.bin + tokens.txt +
espeak-ng-data. Default speaker sid=0 (af — American female blend).
"""

import numpy as np

from ..measure import MODELS_DIR, bench_threads, preload_onnxruntime_dll
from .base import TtsEngine

MODEL_DIR = MODELS_DIR / "kokoro-en-v0_19"
ASSET = "kokoro-en-v0_19.tar.bz2"
SPEAKER_ID = 0
SPEED = 1.0


class SherpaKokoroEn(TtsEngine):
    engine_id = "sherpa-kokoro-en"

    def __init__(self) -> None:
        self._tts = None
        self._threads = bench_threads()

    def load(self) -> None:
        preload_onnxruntime_dll()
        import sherpa_onnx

        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                    model=str(MODEL_DIR / "model.onnx"),
                    voices=str(MODEL_DIR / "voices.bin"),
                    tokens=str(MODEL_DIR / "tokens.txt"),
                    data_dir=str(MODEL_DIR / "espeak-ng-data"),
                ),
                num_threads=self._threads,
                provider="cpu",
            ),
        )
        if not config.validate():
            raise RuntimeError(f"invalid Kokoro config — check {MODEL_DIR}")
        self._tts = sherpa_onnx.OfflineTts(config)

    def synthesize(self, text: str) -> tuple[np.ndarray, int]:
        audio = self._tts.generate(text, sid=SPEAKER_ID, speed=SPEED)
        return np.asarray(audio.samples, dtype=np.float32), audio.sample_rate

    def decode_params(self) -> dict:
        return {
            "model": f"k2-fsa/sherpa-onnx tts-models/{ASSET}",
            "base_model": "hexgrad/Kokoro-82M",
            "sid": SPEAKER_ID,
            "speed": SPEED,
            "num_threads": self._threads,
        }
