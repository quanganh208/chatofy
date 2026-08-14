"""Heavyweight candidate — Whisper large-v3-turbo INT8 via faster-whisper.

Here because the deployment target is a known machine, not an unknown one: 8
physical cores with AVX-512 VNNI and 23GB of free RAM will run a 809M-parameter
model that would be out of the question on a laptop. Whether it runs it FAST
enough is the measurement.

One model covers both languages, which is the other reason to test it — the
alternative stacks need a separate Vietnamese and English model each.

This is a candidate for the displayed transcript only. Whisper is seq2seq: it
re-decodes and rewrites its own prefix, so it can never drive audio that has
already been spoken. That role needs a causal decoder.
"""

from pathlib import Path

from .base import MODELS_DIR, SttEngine, bench_threads

HF_REPO = "deepdml/faster-whisper-large-v3-turbo-ct2"
MODEL_DIR = MODELS_DIR / "faster-whisper-large-v3-turbo-ct2"


class FasterWhisperLargeTurbo(SttEngine):
    """Whisper large-v3-turbo, one instance bound to a language."""

    lang: str

    def __init__(self, lang: str) -> None:
        self.lang = lang
        self.engine_id = f"fw-large-turbo-{lang}"
        self._threads = bench_threads()
        self._model = None

    def load(self) -> None:
        from faster_whisper import WhisperModel

        self._model = WhisperModel(
            str(MODEL_DIR),
            device="cpu",
            compute_type="int8",
            cpu_threads=self._threads,
        )

    def transcribe(self, wav_path: Path) -> str:
        # beam_size=1 to match every other engine here: greedy everywhere, so
        # the comparison is of models rather than of search budgets.
        segments, _info = self._model.transcribe(
            str(wav_path), language=self.lang, beam_size=1
        )
        return " ".join(segment.text.strip() for segment in segments)

    def decode_params(self) -> dict:
        return {
            "model": HF_REPO,
            "base_model": "openai/whisper-large-v3-turbo",
            "compute_type": "int8",
            "beam_size": 1,
            "prefix_monotone": False,
            "num_threads": self._threads,
        }
