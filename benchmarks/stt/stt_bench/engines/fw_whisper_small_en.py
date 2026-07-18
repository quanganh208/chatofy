"""Stack B / en — OpenAI whisper small.en (MIT) via faster-whisper INT8.

English-only Whisper variant; official Systran CT2 conversion, auto-fetched
into models/ by download_models.py. Greedy decoding to match the vi runner.
"""

from pathlib import Path

from .base import MODELS_DIR, SttEngine, bench_threads

MODEL_DIR = MODELS_DIR / "faster-whisper-small.en"
HF_REPO = "Systran/faster-whisper-small.en"


class FasterWhisperSmallEn(SttEngine):
    engine_id = "fw-whisper-small-en"
    lang = "en"

    def __init__(self) -> None:
        self._model = None
        self._threads = bench_threads()

    def load(self) -> None:
        from faster_whisper import WhisperModel

        self._model = WhisperModel(
            str(MODEL_DIR),
            device="cpu",
            compute_type="int8",
            cpu_threads=self._threads,
        )

    def transcribe(self, wav_path: Path) -> str:
        segments, _info = self._model.transcribe(str(wav_path), language="en", beam_size=1)
        return " ".join(segment.text.strip() for segment in segments)

    def decode_params(self) -> dict:
        return {
            "model": HF_REPO,
            "base_model": "openai/whisper-small.en",
            "compute_type": "int8",
            "beam_size": 1,
            "num_threads": self._threads,
        }
