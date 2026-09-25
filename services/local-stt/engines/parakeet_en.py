"""English STT for FINAL transcripts — NVIDIA Parakeet-TDT-0.6b-v2 (INT8 ONNX) via sherpa-onnx.

CC-BY-4.0 (attribution), packaged for sherpa-onnx by the k2-fsa project. Emits
punctuation and casing, the same display style as Moonshine, so a turn reads
the same whichever engine answered it.

Only the settled transcript comes from here. Live partials re-decode the growing
turn every 300ms, and this model costs ~1.5x Moonshine per decode (final p95
~315ms vs ~205ms on an 8s turn, 4 threads), which the partial cadence cannot
absorb — so partials stay on Moonshine. See engines/registry.py.

Measured on real prod turns (6 recordings replayed through the client's own
CapturePump): English WER 3.4 vs Moonshine 7.4, paired per-turn bootstrap
-4.0 points, 95% CI [-7.3, -0.9]. Peak RSS +~1.1GB.
See docs/development-journey.md.
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
