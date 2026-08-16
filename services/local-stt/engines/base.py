"""Shared engine contract for the STT sidecar.

Mirrors `benchmarks/stt/stt_bench/engines/base.py` so the models behave exactly
as they did when they were measured — same runtime, same thread count, same
greedy decoding. Only the input shape differs: the harness reads WAV files off
disk, this service receives already-decoded sample arrays.
"""
import os
import sys
import threading
from abc import ABC, abstractmethod
from pathlib import Path

import numpy as np

SERVICE_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = SERVICE_ROOT / "models"

#: Rate the decoder hands us; both models are trained at 16 kHz.
SAMPLE_RATE = 16000


def stt_threads() -> int:
    """CPU threads per engine. 8 (physical cores) beat 16 (hyperthreads) in the
    recorded spike, so that is the default."""
    return int(os.environ.get("LOCAL_STT_THREADS", "8"))


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


class SttEngine(ABC):
    """One loaded recognizer bound to a single language.

    The lock is per-engine rather than per-process so Vietnamese and English
    requests can overlap; a single sherpa-onnx recognizer object is not assumed
    to be safe for concurrent use.
    """

    lang: str

    def __init__(self) -> None:
        self._recognizer = None
        self._threads = stt_threads()
        self._lock = threading.Lock()

    @abstractmethod
    def load(self) -> None:
        """Build the recognizer. Called once at startup."""

    @property
    def loaded(self) -> bool:
        return self._recognizer is not None

    #: Whether this engine can decode causally, feed by feed.
    #:
    #: False by default because most cannot, and the difference is not a detail
    #: an engine may be vague about: a caller feeds a streaming session because
    #: it intends to SPEAK the result the moment it arrives, and an engine that
    #: silently re-decoded instead would hand it text a later read can revise.
    #: The HTTP layer refuses the session rather than papering over it.
    supports_streaming = False

    def stream(self):
        """Open a causal decoding session. Only for `supports_streaming`."""
        raise NotImplementedError(f"{type(self).__name__} does not stream")

    def postprocess(self, text: str) -> str:
        """Clean up raw decoder output. Default: pass through unchanged.

        Models differ in how they format text — some emit ready-to-display
        prose, others emit bare uppercase tokens — so normalization belongs to
        the engine that knows its own output style.
        """
        return text

    def transcribe(self, samples: np.ndarray) -> str:
        """Transcribe one utterance of mono float32 samples at SAMPLE_RATE."""
        if self._recognizer is None:
            raise RuntimeError(f"{self.lang} engine not loaded")
        # Sync endpoints run in FastAPI's threadpool; the lock serializes
        # concurrent calls so they don't contend on one warm recognizer.
        with self._lock:
            stream = self._recognizer.create_stream()
            stream.accept_waveform(SAMPLE_RATE, samples)
            self._recognizer.decode_stream(stream)
            raw = stream.result.text
        return self.postprocess(raw)
