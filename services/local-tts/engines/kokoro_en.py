"""English TTS — Kokoro-82M (Apache-2.0) via sherpa-onnx OfflineTts.

k2-fsa package kokoro-en-v0_19: model.onnx + voices.bin + tokens.txt +
espeak-ng-data. Default speaker sid=0 (af — American female blend), the voice
the user picked in the A/B listening test.

Measured on this machine: p95 1.18s per sentence, RTF 0.323, 619MB peak RAM.
See plans/reports/tts-en-cpu-benchmark-260718-results-report.md.
"""
import os
import sys
import threading
from pathlib import Path

import numpy as np

SERVICE_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = SERVICE_ROOT / "models"
MODEL_DIR = MODELS_DIR / "kokoro-en-v0_19"


def tts_threads() -> int:
    """CPU threads. 8 (physical cores) beat 16 (hyperthreads) on this machine."""
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


class KokoroEn:
    """The single English voice engine, loaded once and kept warm."""

    def __init__(self) -> None:
        self._tts = None
        self._threads = tts_threads()
        self._lock = threading.Lock()

    def load(self) -> None:
        preload_onnxruntime_dll()
        import sherpa_onnx

        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                    model=str(MODEL_DIR / "model.onnx"),
                    voices=str(MODEL_DIR / "voices.bin"),
                    tokens=str(MODEL_DIR / "tokens.txt"),
                    data_dir=str(MODEL_DIR / "espeak-ng-data"),
                ),
                num_threads=self._threads,
                provider="cpu",
            ),
        )
        # validate() returns False rather than raising on a bad path; skipping
        # this check turns a missing file into an obscure crash much later.
        if not config.validate():
            raise RuntimeError(
                f"invalid Kokoro config — check the model files in {MODEL_DIR}"
            )
        self._tts = sherpa_onnx.OfflineTts(config)

    @property
    def loaded(self) -> bool:
        return self._tts is not None

    @property
    def num_speakers(self) -> int:
        return self._tts.num_speakers if self._tts is not None else 0

    def synthesize(self, text: str, sid: int, speed: float) -> tuple[np.ndarray, int]:
        if self._tts is None:
            raise RuntimeError("engine not loaded")
        # Sync endpoints run in FastAPI's threadpool; the lock serializes
        # concurrent calls against the single warm engine.
        with self._lock:
            audio = self._tts.generate(text, sid=sid, speed=speed)
        return np.asarray(audio.samples, dtype=np.float32), audio.sample_rate
