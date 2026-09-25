"""English STT — NVIDIA Parakeet-TDT-0.6b-v2 (INT8 ONNX) via sherpa-onnx.

CC-BY-4.0 (attribution), packaged for sherpa-onnx by the k2-fsa project. Emits
punctuation and casing, so its output is displayed as-is.

Replaced Moonshine base. Measured on real prod turns (6 recordings replayed
through the client's own CapturePump): English WER 3.4 vs 7.4, paired per-turn
bootstrap -4.0 points, 95% CI [-7.3, -0.9]. See docs/development-journey.md.
"""
from .base import MODELS_DIR, SttEngine

# Extracted from the k2-fsa release tarball by scripts/download_models.py.
MODEL_DIR = MODELS_DIR / "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"


class ParakeetEn(SttEngine):
    lang = "en"

    def load(self) -> None:
        import sherpa_onnx

        self._recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=str(MODEL_DIR / "encoder.int8.onnx"),
            decoder=str(MODEL_DIR / "decoder.int8.onnx"),
            joiner=str(MODEL_DIR / "joiner.int8.onnx"),
            tokens=str(MODEL_DIR / "tokens.txt"),
            num_threads=self._threads,
            model_type="nemo_transducer",
        )
