"""TtsEngine base — the one contract every benchmarked TTS engine implements.

Mirrors the app's `TtsProvider.synthesize` shape (text in → audio out) so
benchmark numbers transfer directly to the integration decision.
"""

from abc import ABC, abstractmethod

import numpy as np


class TtsEngine(ABC):
    """One benchmarked TTS engine (English slot)."""

    engine_id: str

    @abstractmethod
    def load(self) -> None:
        """Load model weights. Timed separately from synthesis."""

    @abstractmethod
    def synthesize(self, text: str) -> tuple[np.ndarray, int]:
        """Synthesize one sentence → (float32 samples in [-1, 1], sample_rate)."""

    @abstractmethod
    def decode_params(self) -> dict:
        """Model package + synthesis settings, recorded in the result header."""
