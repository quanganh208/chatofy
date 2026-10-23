"""The sidecar's own engines, loaded in-process, decoded the way LID needs.

Arm 4 (recognizer competition) and `check_log_probs.py` must measure the
recognizers that ship, not copies of them, so this imports the engine classes
from `services/local-stt` by path. Nothing is reimplemented except the decode
call itself: the sidecar's `transcribe_with_pauses` returns text and pauses,
while a language decision needs the per-token log-probabilities, so the stream
is decoded here over the engine's own recognizer.

Hotwords are never passed. The vi engine switches to `modified_beam_search`
when a turn names terms, and a language decision whose features depend on
whether the conversation had a glossary would drift with it; the decision is
made unbiased and only the winning engine's final decode is ever biased.
"""

from __future__ import annotations

import sys
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[3]
SIDECAR_ROOT = REPO_ROOT / "services" / "local-stt"


def _import_sidecar() -> None:
    if str(SIDECAR_ROOT) not in sys.path:
        sys.path.insert(0, str(SIDECAR_ROOT))


@dataclass(frozen=True)
class Decode:
    lang: str
    text: str
    tokens: list[str]
    log_probs: list[float]
    latency_ms: float


class SidecarEngines:
    """vi/en/zh engines exactly as `engines.registry` builds them."""

    def __init__(self, languages: tuple[str, ...] = ("vi", "en", "zh")) -> None:
        _import_sidecar()
        from engines.base import preload_onnxruntime_dll
        from engines.registry import _ENGINE_TYPES

        preload_onnxruntime_dll()
        self._engines = {}
        for lang in languages:
            engine = _ENGINE_TYPES[lang]()
            engine.load()
            self._engines[lang] = engine

    @property
    def languages(self) -> tuple[str, ...]:
        return tuple(self._engines)

    def decode(self, lang: str, samples: np.ndarray) -> Decode:
        engine = self._engines[lang]
        recognizer = engine.recognizer_for("")
        started = time.perf_counter()
        stream = recognizer.create_stream()
        stream.accept_waveform(16000, samples)
        recognizer.decode_stream(stream)
        result = stream.result
        latency_ms = (time.perf_counter() - started) * 1000
        return Decode(
            lang=lang,
            text=engine.postprocess(result.text),
            tokens=list(result.tokens),
            log_probs=[float(p) for p in result.ys_log_probs],
            latency_ms=latency_ms,
        )


def speech_ms(samples: np.ndarray) -> int:
    """The sidecar's own speech-duration measure, so buckets match its floor."""
    _import_sidecar()
    from audio.speech_duration import speech_duration_ms

    return speech_duration_ms(samples)
