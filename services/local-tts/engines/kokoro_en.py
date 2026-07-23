"""English TTS — Kokoro-82M (Apache-2.0) via sherpa-onnx OfflineTts.

k2-fsa package kokoro-en-v0_19: model.onnx + voices.bin + tokens.txt +
espeak-ng-data. Default speaker sid=0 (af — American female blend), the voice
the user picked in the A/B listening test.

Measured on this machine: p95 1.18s per sentence, RTF 0.323, 619MB peak RAM.
See plans/reports/tts-en-cpu-benchmark-260718-results-report.md.
"""
import os

import numpy as np

from .base import MODELS_DIR, TtsEngine, preload_onnxruntime_dll

MODEL_DIR = MODELS_DIR / "kokoro-en-v0_19"

#: The `af` blend that won the A/B listening test.
DEFAULT_SID = int(os.environ.get("LOCAL_TTS_VOICE_EN", "0"))


class KokoroEn(TtsEngine):
    lang = "en"

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
        # validate() returns False rather than raising on a bad path; skipping
        # this check turns a missing file into an obscure crash much later.
        if not config.validate():
            raise RuntimeError(
                f"invalid Kokoro config — check the model files in {MODEL_DIR}"
            )
        self._engine = sherpa_onnx.OfflineTts(config)

    def _resolve_sid(self, voice: str | None) -> int:
        """Map the contract's string voice to a Kokoro speaker id.

        Anything unparseable or out of range falls back to the default rather
        than failing: /translate is a public API, and a bad voice should not
        cost the caller their audio.
        """
        if voice is None:
            return DEFAULT_SID
        try:
            sid = int(voice)
        except ValueError:
            return DEFAULT_SID
        return sid if 0 <= sid < self._engine.num_speakers else DEFAULT_SID

    def _infer(self, text: str, voice: str | None, speed: float) -> tuple[np.ndarray, int]:
        audio = self._engine.generate(text, sid=self._resolve_sid(voice), speed=speed)
        return np.asarray(audio.samples, dtype=np.float32), audio.sample_rate
