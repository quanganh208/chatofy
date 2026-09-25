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

#: Non-lexical fillers. Parakeet answers audio that carries no words with one of
#: these, where Moonshine answered with nothing: a 150ms cough or knock inside
#: the shape the client sends (320ms pre-roll, the burst, a 150ms tail) came back
#: "Uh" or "Mm." in 5 of 9 cases, Moonshine 0 of 9. The API drops a turn only on
#: an empty transcript, and a reused speculation IS the final, so without this a
#: cough becomes a translated, spoken turn. A real turn that is nothing but a
#: filler is lost too, which costs nothing worth translating. Lexical answers
#: ("Yeah.", "Okay.") are kept even though very short noise can produce them.
FILLERS = frozenset({"uh", "um", "er", "erm", "ah", "mm", "hmm", "mhm", "mm-hmm"})


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

    def postprocess(self, text: str) -> str:
        """Empty when the transcript is only fillers, see `FILLERS`; else as-is."""
        words = [word.strip(".,!?…").lower() for word in text.split()]
        if words and all(word in FILLERS for word in words):
            return ""
        return text
