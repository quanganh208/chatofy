"""English STT — Moonshine base (INT8 ONNX) via sherpa-onnx.

Useful Sensors model (MIT), packaged for sherpa-onnx by the k2-fsa project.
Measured on this machine: 3.86% WER, RTF 0.040, p95 0.34s, 418MB peak RAM.
See plans/reports/stt-cpu-benchmark-260718-results-report.md.
"""
from .base import MODELS_DIR, SttEngine

# Extracted from the k2-fsa release tarball by scripts/download_models.py.
MODEL_DIR = MODELS_DIR / "sherpa-onnx-moonshine-base-en-int8"


class MoonshineEn(SttEngine):
    lang = "en"

    def load(self) -> None:
        import sherpa_onnx

        self._recognizer = sherpa_onnx.OfflineRecognizer.from_moonshine(
            preprocessor=str(MODEL_DIR / "preprocess.onnx"),
            encoder=str(MODEL_DIR / "encode.int8.onnx"),
            uncached_decoder=str(MODEL_DIR / "uncached_decode.int8.onnx"),
            cached_decoder=str(MODEL_DIR / "cached_decode.int8.onnx"),
            tokens=str(MODEL_DIR / "tokens.txt"),
            num_threads=self._threads,
        )
