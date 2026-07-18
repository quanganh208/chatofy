"""Measurement utilities — latency stats, peak-RSS sampling, ORT DLL preload.

Self-contained copies of the patterns proven in benchmarks/stt (stt_bench
metrics + base): the two benchmark projects stay independent on purpose so
either can be deleted or evolved without breaking the other.
"""

import os
import sys
import threading
import time
from pathlib import Path

import numpy as np
import psutil

BENCH_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = BENCH_ROOT / "models"


def bench_threads() -> int:
    """CPU threads per engine; TTS_BENCH_THREADS env, default 8 (physical cores)."""
    return int(os.environ.get("TTS_BENCH_THREADS", "8"))


def preload_onnxruntime_dll() -> None:
    """Load the venv's onnxruntime.dll before sherpa-onnx native code runs.

    Same Windows hazard as the STT harness: the sherpa-onnx wheel bundles no
    onnxruntime.dll, and System32 ships the Windows ML build (reports ORT
    1.17.1) which aborts the process on C-API mismatch. Preloading pins the
    module name to the correct in-process copy.
    """
    if sys.platform != "win32":
        return
    import ctypes

    import onnxruntime

    capi_dir = Path(onnxruntime.__file__).parent / "capi"
    ctypes.WinDLL(str(capi_dir / "onnxruntime.dll"))


def latency_stats(samples_seconds: list[float]) -> dict[str, float]:
    """Mean / p50 / p95 over per-sentence synthesis times (seconds)."""
    if not samples_seconds:
        raise ValueError("no latency samples")
    arr = np.asarray(samples_seconds, dtype=np.float64)
    return {
        "mean_s": float(arr.mean()),
        "p50_s": float(np.percentile(arr, 50)),
        "p95_s": float(np.percentile(arr, 95)),
    }


class PeakRssSampler:
    """Samples process-tree RSS in a background thread, records the peak."""

    def __init__(self, pid: int | None = None, interval_s: float = 0.1):
        self._process = psutil.Process(pid)
        self._interval_s = interval_s
        self._peak_bytes = 0
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._sample_loop, daemon=True)

    def _tree_rss(self) -> int:
        total = 0
        try:
            total = self._process.memory_info().rss
            for child in self._process.children(recursive=True):
                try:
                    total += child.memory_info().rss
                except psutil.NoSuchProcess:
                    continue
        except psutil.NoSuchProcess:
            pass
        return total

    def _sample_loop(self) -> None:
        while not self._stop_event.is_set():
            self._peak_bytes = max(self._peak_bytes, self._tree_rss())
            time.sleep(self._interval_s)

    def start(self) -> "PeakRssSampler":
        self._peak_bytes = self._tree_rss()
        self._thread.start()
        return self

    def stop(self) -> float:
        """Stop sampling; returns peak RSS in MB."""
        self._stop_event.set()
        self._thread.join(timeout=2)
        self._peak_bytes = max(self._peak_bytes, self._tree_rss())
        return self._peak_bytes / (1024 * 1024)


def load_sentences(path: Path) -> list[tuple[str, str]]:
    """Load the sentence set as (sentence_id, text); skips comments/blanks."""
    sentences = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            sentences.append((f"s{len(sentences) + 1:03d}", line))
    if not sentences:
        raise ValueError(f"no sentences in {path}")
    return sentences
