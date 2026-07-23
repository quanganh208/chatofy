"""Shared engine contract for the TTS sidecar.

Mirrors `services/local-stt/engines/base.py`. The two voices run on different
runtimes — Kokoro through sherpa-onnx, Vietnamese through the vieneu package —
so this base only fixes what they genuinely share: eager loading, a lock, and
a `synthesize` that returns samples plus their rate.

`voice` is a plain string at this boundary because that is what the app's
TtsProvider contract carries. Each engine interprets it its own way (a speaker
id for Kokoro, a preset name for VieNeu) and falls back to its own default when
the value makes no sense for it.
"""
import os
import sys
import threading
from abc import ABC, abstractmethod
from pathlib import Path

import numpy as np

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
    """One loaded voice bound to a single language."""

    lang: str

    def __init__(self) -> None:
        self._engine = None
        self._threads = tts_threads()
        self._lock = threading.Lock()

    @abstractmethod
    def load(self) -> None:
        """Build the engine. Called once at startup."""

    @abstractmethod
    def _infer(self, text: str, voice: str | None, speed: float) -> tuple[np.ndarray, int]:
        """Synthesize under the caller's lock. Returns (samples, sample_rate)."""

    @property
    def loaded(self) -> bool:
        return self._engine is not None

    def synthesize(
        self, text: str, voice: str | None = None, speed: float = 1.0
    ) -> tuple[np.ndarray, int]:
        if self._engine is None:
            raise RuntimeError(f"{self.lang} engine not loaded")
        # Sync endpoints run in FastAPI's threadpool; the lock serializes
        # concurrent calls against the single warm engine.
        with self._lock:
            return self._infer(text, voice, speed)
