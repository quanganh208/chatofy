"""SttEngine base — the one contract every benchmarked engine implements.

Mirrors the app's `SttProvider.transcribe` shape (batch, one utterance in →
text out) so benchmark numbers transfer directly to the integration decision.
"""

import os
import sys
from abc import ABC, abstractmethod
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent.parent
MODELS_DIR = BENCH_ROOT / "models"


def bench_threads() -> int:
    """CPU threads per engine; STT_BENCH_THREADS env, default 8 (physical cores)."""
    return int(os.environ.get("STT_BENCH_THREADS", "8"))


def preload_onnxruntime_dll() -> None:
    """Load the venv's onnxruntime.dll before sherpa-onnx native code runs.

    The sherpa-onnx Windows wheel does not bundle onnxruntime.dll; without this
    the loader resolves the name via PATH and finds the Windows ML build in
    System32 (reports ORT 1.17.1), which lacks the C API version sherpa-onnx
    was built against — the process then dies with a hard abort, not a Python
    exception. Preloading pins the name to the correct in-process module.
    """
    if sys.platform != "win32":
        return
    import ctypes

    import onnxruntime

    capi_dir = Path(onnxruntime.__file__).parent / "capi"
    ctypes.WinDLL(str(capi_dir / "onnxruntime.dll"))


class SttEngine(ABC):
    """One benchmarked STT engine bound to a single language."""

    engine_id: str
    lang: str
    #: True when transcription crosses the network — the report labels its
    #: timing "wall latency incl. network" instead of RTF.
    is_cloud: bool = False

    @abstractmethod
    def load(self) -> None:
        """Load model weights into memory. Timed separately from inference."""

    @abstractmethod
    def transcribe(self, wav_path: Path) -> str:
        """Transcribe one 16 kHz mono PCM16 WAV utterance."""

    @abstractmethod
    def decode_params(self) -> dict:
        """Model revision + decode settings, recorded in the result header
        for thesis reproducibility."""
