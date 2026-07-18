"""Engine registry — stable ids used in CLI args, results, and the report."""

from collections.abc import Callable

from .base import TtsEngine
from .sherpa_kokoro_en import SherpaKokoroEn
from .sherpa_piper_en import SherpaPiperEn

ENGINE_REGISTRY: dict[str, Callable[[], TtsEngine]] = {
    "sherpa-kokoro-en": SherpaKokoroEn,
    "sherpa-piper-en": SherpaPiperEn,
}


def create_engine(engine_id: str) -> TtsEngine:
    if engine_id not in ENGINE_REGISTRY:
        raise KeyError(f"unknown engine {engine_id!r}; known: {sorted(ENGINE_REGISTRY)}")
    return ENGINE_REGISTRY[engine_id]()
