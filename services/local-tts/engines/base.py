"""Shared engine contract for the TTS sidecar.

Mirrors `services/local-stt/engines/base.py`. The two voices run on different
runtimes — Kokoro through sherpa-onnx, Vietnamese through the vieneu package —
so this base only fixes what they genuinely share: eager loading, a lock, and
a `synthesize` that returns samples plus their rate.

Callers ask for a voice by GENDER, which is the only way to name a voice that
means the same thing to two unrelated runtimes. Each engine owns the tokens
that gender resolves to — a speaker id for Kokoro, a preset name for VieNeu —
and nothing outside this service names those values.
"""
import os
import sys
import threading
from abc import ABC, abstractmethod
from collections.abc import Mapping
from pathlib import Path
from typing import ClassVar

import numpy as np

#: Used when the caller names no gender, or names one this engine has no voice
#: for. Matches the default in the app's wire contract.
DEFAULT_GENDER = "female"

SERVICE_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = SERVICE_ROOT / "models"


def tts_threads() -> int:
    """CPU threads per engine. 8 (physical cores) beat 16 (hyperthreads) here."""
    return int(os.environ.get("LOCAL_TTS_THREADS", "8"))


def preload_onnxruntime_dll() -> None:
    """Load the venv's onnxruntime.dll before sherpa-onnx native code runs.

    The sherpa-onnx Windows wheel does not bundle onnxruntime.dll; without this
    the loader resolves the name via PATH and finds the Windows ML build in
    System32 (reports ORT 1.17.1), which lacks the C API version sherpa-onnx
    was built against — the process then dies with a hard abort, not a Python
    exception. Preloading pins the name to the correct in-process module.

    Must run before any `import sherpa_onnx`.
    """
    if sys.platform != "win32":
        return
    import ctypes

    import onnxruntime

    capi_dir = Path(onnxruntime.__file__).parent / "capi"
    ctypes.WinDLL(str(capi_dir / "onnxruntime.dll"))


class TtsEngine(ABC):
    """One loaded language, speakable in either gender."""

    lang: str
    #: Gender to the token this engine's runtime addresses that voice by.
    #: Both entries are required: gender is a closed set, so a missing one
    #: would be a silent downgrade to the other voice.
    VOICES: ClassVar[Mapping[str, int | str]]

    def __init__(self) -> None:
        self._engine = None
        self._threads = tts_threads()
        self._lock = threading.Lock()

    @abstractmethod
    def load(self) -> None:
        """Build the engine. Called once at startup."""

    @abstractmethod
    def _infer(self, text: str, voice: int | str, speed: float) -> tuple[np.ndarray, int]:
        """Synthesize with an already-resolved voice token, under the caller's
        lock. Returns (samples, sample_rate)."""

    @property
    def loaded(self) -> bool:
        return self._engine is not None

    def _voice_for(self, gender: str | None) -> int | str:
        """Resolve a requested gender to this engine's voice token.

        An unrecognised gender falls back instead of raising: /translate is a
        public API, and a strange value should not cost the caller their audio.
        """
        return self.VOICES.get(gender or DEFAULT_GENDER, self.VOICES[DEFAULT_GENDER])

    def synthesize(
        self, text: str, gender: str | None = None, speed: float = 1.0
    ) -> tuple[np.ndarray, int]:
        if self._engine is None:
            raise RuntimeError(f"{self.lang} engine not loaded")
        # Sync endpoints run in FastAPI's threadpool; the lock serializes
        # concurrent calls against the single warm engine.
        with self._lock:
            return self._infer(text, self._voice_for(gender), speed)
