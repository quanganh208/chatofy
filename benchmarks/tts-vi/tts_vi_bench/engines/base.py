"""TtsEngine base — the contract every benchmarked Vietnamese TTS engine implements.

Two additions over the English harness's version, each forced by what this
comparison has to measure:

- `synthesize` takes a **voice**, because each engine is measured on two of them
  rather than on one fixed speaker.
- `synthesize_stream` exists at all, because time-to-first-audio is the metric
  most likely to decide the result. Both benchmarked engines stream and both
  override it; the base still declares streaming unsupported so that an engine
  added later says so by inheriting rather than by raising, and so a caller
  reads `supports_streaming` rather than assuming.
"""

from abc import ABC, abstractmethod
from collections.abc import Iterator

import numpy as np


class TtsEngine(ABC):
    """One benchmarked Vietnamese TTS engine, at one voice."""

    engine_id: str
    #: gender -> voice token. The pair each engine speaks with by default, which
    #: is what `services/local-tts` exposes to callers through `POST /synthesize`.
    VOICES: dict[str, str]
    #: Whether `synthesize_stream` is real. False here; overridden where true.
    supports_streaming: bool = False

    @abstractmethod
    def load(self) -> None:
        """Load model weights. Timed separately from synthesis."""

    @abstractmethod
    def synthesize(self, text: str, voice: str) -> tuple[np.ndarray, int]:
        """Synthesize one sentence → (float32 samples in [-1, 1], sample_rate)."""

    def synthesize_stream(self, text: str, voice: str) -> Iterator[np.ndarray]:
        """Yield audio chunks as they are generated.

        The default is not a stub that returns nothing — it raises, so a caller
        that reaches it has a bug rather than a silently empty measurement.
        Check `supports_streaming` first.
        """
        raise NotImplementedError(f"{self.engine_id} does not stream")

    @abstractmethod
    def decode_params(self) -> dict:
        """Everything needed to reproduce this run, recorded in the result header.

        For a stochastic engine this includes the seed and every sampling
        parameter: without them a recorded number cannot be reproduced even on
        the same machine with the same weights.
        """
