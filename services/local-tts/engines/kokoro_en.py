"""English TTS — Kokoro-82M (Apache-2.0) via sherpa-onnx OfflineTts.

k2-fsa package kokoro-en-v0_19: model.onnx + voices.bin + tokens.txt +
espeak-ng-data.

Measured on this machine: p95 1.18s per sentence, RTF 0.323, 619MB peak RAM.
See docs/development-journey.md.
"""
import numpy as np

from .base import MODELS_DIR, TtsEngine, preload_onnxruntime_dll

MODEL_DIR = MODELS_DIR / "kokoro-en-v0_19"


class KokoroEn(TtsEngine):
    lang = "en"
    #: Kokoro speaker ids, chosen by listening to all 11 speakers in the
    #: package: 3 = `af_sarah`, 5 = `am_adam`.
    VOICES = {"female": 3, "male": 5}

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

    def _infer(self, text: str, voice: int | str, speed: float) -> tuple[np.ndarray, int]:
        audio = self._engine.generate(text, sid=int(voice), speed=speed)
        return np.asarray(audio.samples, dtype=np.float32), audio.sample_rate
