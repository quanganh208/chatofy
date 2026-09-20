"""Vietnamese TTS — VieNeu v3 Turbo (ONNX/CPU, torch-free). The incumbent.

Constructed exactly as `services/local-tts/engines/vieneu_vi.py` constructs it,
because the point of this arm is to measure what the service actually ships. The
`fp32` pin is the part most easily lost: the sidecar records that fp32 is the graph
its two voices were auditioned on.

It is also no longer the package's non-default, which it was when this arm was
first written. Through 3.3.0 `vieneu` shipped an int8 backbone graph unless told
otherwise; 3.4.0 made fp32 the default. So the pin now states a choice rather than
correcting one. int8 is measured as its own arm (`vieneu_vi_int8.py`) instead of
being folded in here, so the two graphs are compared rather than one silently
standing in for the other.

**Seeding.** `infer` and `infer_stream` both sample — `temperature=0.8,
top_k=25, top_p=0.95, repetition_penalty=1.2`, the same defaults ZeroTTS uses —
and the draw is a single `np.random.choice` per frame inside
`vieneu/_v3_turbo_engine/onnx_runtime_lite.py`, against the *global* numpy RNG,
with no seed parameter anywhere in the call chain. Unseeded, every latency, RTF,
TTFA and WER figure is one draw from a distribution rather than a measurement.
The first run of this benchmark seeded ZeroTTS and not this engine, then
reported the resulting asymmetry — ZeroTTS reproducible 41/41, VieNeu 0/41 — as
a reliability property of the engines. It was a property of the harness.
`scripts/check_vieneu_seeding.py` measures the fix: 8/8 reproducible per voice,
within a process and across two.

**Streaming.** `infer_stream` is real, and is a generator function, so calling it
runs nothing — not `_resolve_ref`, not text chunking — and the per-frame draws
happen lazily as the consumer iterates. The seed is therefore applied
immediately before the first `next()`, exactly as in the ZeroTTS adapter, and
not before the call.

Two things the streamed path does differently from `infer`, recorded because
they are audible rather than incidental: it yields the engine's native
frame-level sub-chunks (which is where its low first-audio latency comes from),
and it does *not* run `join_audio_chunks`, so the inter-chunk silences `infer`
inserts at sentence and clause boundaries are absent. Whole and streamed
synthesis of the same text are therefore not expected to be sample-identical
even at one seed.
"""

from collections.abc import Iterator

import numpy as np

from ..measure import SEED, bench_threads
from .base import TtsEngine

#: The two presets the sidecar speaks with, by gender. Both were chosen upstream
#: by listening to every voice the model shipped.
DEFAULTS = {"female": "Mai Anh", "male": "Thanh Bình"}


class VieNeuVi(TtsEngine):
    engine_id = "vieneu-vi"
    VOICES = DEFAULTS
    supports_streaming = True
    #: Which ONNX backbone graph to load. fp32 is what the sidecar ships; the int8
    #: subclass overrides it so the two graphs become two comparable arms.
    PRECISION = "fp32"

    def __init__(self) -> None:
        self._engine = None
        self._threads = bench_threads()

    def load(self) -> None:
        from vieneu import Vieneu

        self._engine = Vieneu(
            mode="v3turbo",  # CPU -> torch-free ONNX
            precision=self.PRECISION,
            threads=self._threads,
        )

    def synthesize(self, text: str, voice: str) -> tuple[np.ndarray, int]:
        np.random.seed(SEED)
        samples = self._engine.infer(text, voice=str(voice))
        return np.asarray(samples, dtype=np.float32).reshape(-1), self._engine.sample_rate

    def synthesize_stream(self, text: str, voice: str) -> Iterator[np.ndarray]:
        """Yield chunks, seeding at the point the draws actually happen."""
        stream = self._engine.infer_stream(text, voice=str(voice))
        np.random.seed(SEED)
        for chunk in stream:
            yield np.asarray(chunk, dtype=np.float32).reshape(-1)

    @property
    def sample_rate(self) -> int:
        return self._engine.sample_rate

    def decode_params(self) -> dict:
        import importlib.metadata as md

        return {
            "package": "vieneu",
            "package_version": md.version("vieneu"),
            "mode": "v3turbo",
            "precision": self.PRECISION,
            "threads": self._threads,
            "seed": SEED,
            "seed_applied_at": "immediately before iteration (stream) / call (whole)",
            "stochastic": True,
            # The package's own defaults, recorded because they are what was run
            # — this arm calls `infer`/`infer_stream` with sampling arguments
            # omitted, which is how the sidecar calls them.
            "temperature": 0.8,
            "top_k": 25,
            "top_p": 0.95,
            "repetition_penalty": 1.2,
            "repetition_window": 64,
            "max_new_frames": 300,
            "max_chars": 256,
            "apply_watermark": True,
            # `infer` only: the streamed path yields sub-chunks directly and
            # never joins them, so these two do not apply to it.
            "whole_only_silence_p": 0.15,
            "whole_only_crossfade_p": 0.0,
        }
