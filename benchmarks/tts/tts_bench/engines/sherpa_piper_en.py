"""Piper VITS en_US-lessac-high (MIT) via sherpa-onnx OfflineTts.

k2-fsa package vits-piper-en_US-lessac-high: en_US-lessac-high.onnx +
tokens.txt + espeak-ng-data. Single-speaker voice.
"""

import numpy as np

from ..measure import MODELS_DIR, bench_threads, preload_onnxruntime_dll
from .base import TtsEngine

MODEL_DIR = MODELS_DIR / "vits-piper-en_US-lessac-high"
ASSET = "vits-piper-en_US-lessac-high.tar.bz2"
SPEED = 1.0


class SherpaPiperEn(TtsEngine):
    engine_id = "sherpa-piper-en"

    def __init__(self) -> None:
        self._tts = None
        self._threads = bench_threads()

    def load(self) -> None:
        preload_onnxruntime_dll()
        import sherpa_onnx

        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                    model=str(MODEL_DIR / "en_US-lessac-high.onnx"),
                    tokens=str(MODEL_DIR / "tokens.txt"),
                    data_dir=str(MODEL_DIR / "espeak-ng-data"),
                ),
                num_threads=self._threads,
                provider="cpu",
            ),
        )
        if not config.validate():
            raise RuntimeError(f"invalid Piper config — check {MODEL_DIR}")
        self._tts = sherpa_onnx.OfflineTts(config)

    def synthesize(self, text: str) -> tuple[np.ndarray, int]:
        audio = self._tts.generate(text, sid=0, speed=SPEED)
        return np.asarray(audio.samples, dtype=np.float32), audio.sample_rate

    def decode_params(self) -> dict:
        return {
            "model": f"k2-fsa/sherpa-onnx tts-models/{ASSET}",
            "base_model": "rhasspy/piper en_US-lessac-high",
            "speed": SPEED,
            "num_threads": self._threads,
        }
