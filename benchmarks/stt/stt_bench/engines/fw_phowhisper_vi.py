"""Stack B / vi — PhoWhisper-small (VinAI, BSD-3) via faster-whisper INT8.

Uses the community CTranslate2 conversion diepho/PhoWhisper-small-ct2;
download_models.py records the exact revision. Greedy decoding (beam_size=1)
to measure the latency-optimized configuration.
"""

from pathlib import Path

from .base import MODELS_DIR, SttEngine, bench_threads

MODEL_DIR = MODELS_DIR / "phowhisper-small-ct2"
HF_REPO = "diepho/PhoWhisper-small-ct2"


class FasterWhisperPhoWhisperVi(SttEngine):
    engine_id = "fw-phowhisper-vi"
    lang = "vi"

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
        segments, _info = self._model.transcribe(str(wav_path), language="vi", beam_size=1)
        # Generator — consuming it here keeps decode time inside the timed window.
        return " ".join(segment.text.strip() for segment in segments)

    def decode_params(self) -> dict:
        return {
            "model": HF_REPO,
            "base_model": "vinai/PhoWhisper-small",
            "compute_type": "int8",
            "beam_size": 1,
            "num_threads": self._threads,
        }
