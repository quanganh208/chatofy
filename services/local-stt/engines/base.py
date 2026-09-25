"""Shared engine contract for the STT sidecar.

Mirrors `benchmarks/stt/stt_bench/engines/base.py` so the models behave exactly
as they did when they were measured — same runtime, same thread count, same
greedy decoding. Only the input shape differs: the harness reads WAV files off
disk, this service receives already-decoded sample arrays.
"""
import logging
import os
import sys
import threading
import time
from abc import ABC, abstractmethod
from pathlib import Path

import numpy as np

SERVICE_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = SERVICE_ROOT / "models"

#: Rate the decoder hands us; both models are trained at 16 kHz.
SAMPLE_RATE = 16000

#: A request that waited this long just to ENTER the engine is logged. Below
#: this it is noise: at the measured per-decode cost (70-250ms), a short wait is
#: the queue doing its job.
SLOW_WAIT_MS = 250.0

logger = logging.getLogger(__name__)


def stt_threads() -> int:
    """CPU threads per engine. 8 (physical cores) beat 16 (hyperthreads) in the
    recorded spike, so that is the default."""
    return int(os.environ.get("LOCAL_STT_THREADS", "8"))


def stt_concurrency() -> int:
    """Decodes this engine runs at once, over its ONE recognizer.

    The API fans out many decodes per turn (live-preview re-reads every 300ms,
    speculations, finals), and an engine that serves them one at a time queues
    them invisibly while the machine idles — measured on prod: 6 concurrent
    requests took the same wall time as 6 serial ones, while ~72% of the cores
    sat unused.

    Concurrency is a semaphore over the single recognizer rather than a pool of
    recognizer copies, on two measurements rather than an assumption:
    - 120 concurrent decodes through one recognizer (both engines, mixed clips,
      30 rounds) produced transcripts byte-identical to their serial baselines;
    - concurrent decodes on the shared ONNX session scale (~2.3x throughput at
      6 workers, num_threads=1) — the callers provide the parallelism, the
      session's intra-op pool does not serialize them.
    The zero-memory property is the point: a pool of recognizer copies would
    multiply the weights (~223MB vi / ~1.1GB en per instance) against the
    sidecar's own 4GB container limit, which four concurrent 60s English
    decodes already take to ~3GB peak RSS.
    """
    # Clamped rather than validated with an error: a semaphore of 0 or fewer
    # refuses every request (all 503), which is a confusing way to learn about
    # a typo in the environment. The floor of 1 is the old serial behavior.
    return max(1, int(os.environ.get("LOCAL_STT_CONCURRENCY", "4")))


def stt_lane_wait_ms() -> float:
    """How long a request may wait for a lane before the sidecar refuses it.

    Refused, not queued: an invisible queue inside the sidecar is how the
    serialization went undiagnosed. At the measured decode cost, 2 seconds
    covers a request arriving behind several others; exceeding it means the
    engine is genuinely saturated and the caller should hear 503 rather than
    hold a turn slot for work that will be late anyway.
    """
    return float(os.environ.get("LOCAL_STT_LANE_WAIT_MS", "2000"))


class SttBusyError(Exception):
    """Every decode lane was busy for longer than the wait budget. Maps to 503."""


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

    The semaphore is per-engine rather than per-process so Vietnamese and
    English requests never contend with each other. Within an engine, up to
    `stt_concurrency()` requests decode simultaneously through the shared
    recognizer — safe and scaling by measurement, see `stt_concurrency()`. A
    request that cannot get a lane within the wait budget is refused with
    `SttBusyError` rather than allowed to queue invisibly.
    """

    lang: str

    #: Whether this engine can be biased towards a hotword list.
    #:
    #: A property of the decoding method rather than of the language: contextual
    #: biasing needs a transducer decoded with `modified_beam_search` and a BPE
    #: vocabulary to map the terms onto. An engine that says False is handed no
    #: hotwords at all, rather than being handed them and left to ignore them —
    #: sherpa-onnx takes the argument on every recognizer type, so a silent
    #: no-op is exactly the failure that would go unnoticed.
    supports_hotwords: bool = False

    def __init__(self) -> None:
        self._recognizer = None
        self._threads = stt_threads()
        self._lanes = threading.Semaphore(stt_concurrency())
        self._lane_wait_ms = stt_lane_wait_ms()

    @abstractmethod
    def load(self) -> None:
        """Build the recognizer. Called once at startup."""

    @property
    def loaded(self) -> bool:
        return self._recognizer is not None

    def postprocess(self, text: str) -> str:
        """Clean up raw decoder output. Default: pass through unchanged.

        Models differ in how they format text — some emit ready-to-display
        prose, others emit bare uppercase tokens — so normalization belongs to
        the engine that knows its own output style.
        """
        return text

    def recognizer_for(self, hotwords: str):
        """Which recognizer decodes this utterance.

        A hook rather than a field because biasing and speed are answered by
        different decoders, and only the engine knows whether it has both. The
        default has one and uses it for everything.
        """
        return self._recognizer

    def transcribe(self, samples: np.ndarray, hotwords: str = "") -> str:
        """Transcribe one utterance of mono float32 samples at SAMPLE_RATE.

        `hotwords` is the `/`-separated list to bias decoding towards, and is per
        UTTERANCE rather than per engine: the terms belong to the conversation
        being transcribed. Empty means no biasing, which is also what keeps an
        ordinary turn on the faster decoder.
        """
        if self._recognizer is None:
            raise RuntimeError(f"{self.lang} engine not loaded")
        # Sync endpoints run in FastAPI's threadpool, so requests arrive
        # concurrently; the lanes bound how many decodes run at once. The wait
        # for a lane is timed so saturation refuses loudly instead of queuing.
        started = time.perf_counter()
        if not self._lanes.acquire(timeout=self._lane_wait_ms / 1000):
            raise SttBusyError(
                f"{self.lang} engine saturated: no lane within {self._lane_wait_ms:.0f}ms"
            )
        waited_ms = (time.perf_counter() - started) * 1000
        if waited_ms > SLOW_WAIT_MS:
            logger.warning(
                "%s engine: request waited %.0fms for a decode lane",
                self.lang,
                waited_ms,
            )
        try:
            biased = bool(hotwords) and self.supports_hotwords
            recognizer = self.recognizer_for(hotwords if biased else "")
            stream = (
                recognizer.create_stream(hotwords=hotwords)
                if biased
                else recognizer.create_stream()
            )
            stream.accept_waveform(SAMPLE_RATE, samples)
            recognizer.decode_stream(stream)
            raw = stream.result.text
        finally:
            self._lanes.release()
        return self.postprocess(raw)
