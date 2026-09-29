"""A pinned Silero VAD gate: how much of a clip Silero calls speech.

`audio/speech_duration.py` answers this question with energy, for `/embed`,
which only compares the number to itself across turns. This module exists
because `/transcribe`'s `min_speech_ms` decides something harder — whether to
run the decoder at all, and whether the clusterer ever sees the turn — and a
music bed or a room tone sits above an energy floor while carrying no words. A
learned detector is the only thing here that tells the two apart.

**Pinned by sha256, not by filename.** Silero's own repository has replaced
the asset at a stable-looking path before; a caller that accepted whatever a
URL currently returns would have the gate's floor move under it silently.
`load()` refuses to start on a hash mismatch — fail closed, not a gate that
quietly drifted.

**A pool, not one detector behind a lock.** `/transcribe` already runs one
decode per request through an engine's own lane semaphore
(`engines/base.py`); serializing every request through a single VAD instance
in front of that would make Silero the new bottleneck. Sized to
`stt_concurrency() * len(SUPPORTED_LANGUAGES)` — one lane's worth of
detectors per language engine, since vi and en each run their own
`stt_concurrency()` decode lanes and a turn on either may gate. Sizing the
pool to a single engine's lane count would let the busier engine queue behind
the other's gated requests, which is exactly the invisible serialization this
pool exists to avoid. A caller who still cannot get a detector within the
lane wait budget gets `SttBusyError` — the same 503 an engine at capacity
returns.
"""
import hashlib
import queue
from pathlib import Path

import numpy as np

from engines.base import MODELS_DIR, SAMPLE_RATE, SttBusyError, stt_concurrency, stt_lane_wait_ms
from engines.registry import SUPPORTED_LANGUAGES

MODEL_FILENAME = "silero_vad.onnx"

#: k2-fsa republishes Silero's classic single-file ONNX export (state fed back
#: in, not the newer split graph) under the same release tag the parakeet
#: tarball comes from. Verified against sherpa-onnx 1.13.4's
#: `VoiceActivityDetector` on 2026-09-29.
MODEL_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx"
MODEL_SHA256 = "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6"

#: The harness's Silero parameters
#: (`plans/260929-1038-conversation-quality-harness/vad.py:9`), so the
#: sidecar's speech/no-speech line matches the one the 300ms floor was
#: measured against. `window_size` is sherpa-onnx's own step for the Silero
#: graph at 16kHz, not a harness constant.
VAD_THRESHOLD = 0.5
MIN_SPEECH_DURATION_S = 0.25
MIN_SILENCE_DURATION_S = 0.25
WINDOW_SIZE = 512
MAX_SPEECH_DURATION_S = 20.0


class ModelHashMismatchError(Exception):
    """The cached model file does not match the pinned sha256. Fail closed."""


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class SileroSpeechGate:
    """A pool of pinned Silero detectors, one lane wait budget for all of them."""

    def __init__(self, model_path: Path | None = None) -> None:
        self._model_path = model_path or (MODELS_DIR / MODEL_FILENAME)
        self._pool: "queue.Queue | None" = None
        self._lane_wait_ms = stt_lane_wait_ms()

    @property
    def loaded(self) -> bool:
        return self._pool is not None

    def load(self) -> None:
        """Verify the pinned hash, then build one detector per lane.

        Must run after `engines.base.preload_onnxruntime_dll()` — like every
        other model here, importing sherpa-onnx before that preload resolves
        the wrong shared library and aborts the process with no traceback.
        """
        if not self._model_path.exists():
            raise FileNotFoundError(
                f"{self._model_path} is missing. Run: python scripts/download_models.py"
            )
        actual = sha256_of(self._model_path)
        if actual != MODEL_SHA256:
            raise ModelHashMismatchError(
                f"{self._model_path} sha256 {actual} != pinned {MODEL_SHA256}"
            )

        import sherpa_onnx

        config = sherpa_onnx.VadModelConfig(
            silero_vad=sherpa_onnx.SileroVadModelConfig(
                model=str(self._model_path),
                threshold=VAD_THRESHOLD,
                min_silence_duration=MIN_SILENCE_DURATION_S,
                min_speech_duration=MIN_SPEECH_DURATION_S,
                window_size=WINDOW_SIZE,
                max_speech_duration=MAX_SPEECH_DURATION_S,
            ),
            sample_rate=SAMPLE_RATE,
            num_threads=1,
            provider="cpu",
        )
        if not config.validate():
            raise RuntimeError(f"invalid Silero VAD config for {self._model_path}")

        size = stt_concurrency() * len(SUPPORTED_LANGUAGES)
        pool: "queue.Queue" = queue.Queue(maxsize=size)
        for _ in range(size):
            pool.put(sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=60))
        self._pool = pool

    def unload(self) -> None:
        self._pool = None

    def speech_ms(self, samples: np.ndarray) -> int:
        """Milliseconds of `samples` (mono float32 @ SAMPLE_RATE) Silero calls speech.

        Raises `SttBusyError` if every detector is busy past the lane wait
        budget, mapped to 503 by the caller, same as a saturated engine.
        """
        # Captured once, rather than read again from `self._pool` inside
        # `finally`: `unload()` can run concurrently on another request and
        # sets `self._pool = None`, and `finally` still has to give this
        # detector back to the SAME queue it came from, whether or not the
        # gate is still considered loaded by the time this call finishes.
        pool = self._pool
        if pool is None:
            raise RuntimeError("Silero VAD not loaded")
        try:
            detector = pool.get(timeout=self._lane_wait_ms / 1000)
        except queue.Empty:
            raise SttBusyError(
                f"silero VAD saturated: no detector within {self._lane_wait_ms:.0f}ms"
            ) from None
        try:
            detector.reset()
            total_samples = _feed(detector, samples)
        finally:
            pool.put(detector)
        return round(total_samples / SAMPLE_RATE * 1000)


def _feed(detector, samples: np.ndarray) -> int:
    """Sum of detected segment lengths, in samples, with a flush at the end.

    Fed in fixed `WINDOW_SIZE` chunks — sherpa-onnx's Silero graph steps on
    exactly that many samples per call, so anything else would be silently
    truncated at the last partial chunk before it ever reaches the model. A
    trailing partial chunk shorter than one window is dropped rather than
    padded: padding it with zeros would let it end mid-speech and lose real
    voice off the end of a turn.
    """
    n = len(samples)
    for i in range(0, n - n % WINDOW_SIZE, WINDOW_SIZE):
        detector.accept_waveform(samples[i : i + WINDOW_SIZE])
    detector.flush()
    total = 0
    while not detector.empty():
        total += len(detector.front.samples)
        detector.pop()
    return total
