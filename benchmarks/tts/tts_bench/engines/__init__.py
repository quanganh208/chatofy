"""Engine registry — stable ids used in CLI args, results, and the report.

Single-speaker engines take no speaker id. The Kokoro multi-lang configs are
multi-speaker and need one; `create_engine` refuses a mismatch either way, so a
run can never silently use a default speaker it did not ask for.
"""

from collections.abc import Callable

from .base import TtsEngine
from .sherpa_kokoro_en import SherpaKokoroEn
from .sherpa_kokoro_multi import CONFIGS as KOKORO_MULTI_CONFIGS
from .sherpa_kokoro_multi import SherpaKokoroMulti
from .sherpa_piper_en import SherpaPiperEn

ENGINE_REGISTRY: dict[str, Callable[[], TtsEngine]] = {
    "sherpa-kokoro-en": SherpaKokoroEn,
    "sherpa-piper-en": SherpaPiperEn,
}
MULTI_SPEAKER_ENGINES = frozenset(KOKORO_MULTI_CONFIGS)


def create_engine(engine_id: str, sid: int | None = None) -> TtsEngine:
    if engine_id in MULTI_SPEAKER_ENGINES:
        if sid is None:
            raise ValueError(f"{engine_id} is multi-speaker; pass --sid")
        return SherpaKokoroMulti(engine_id, sid)
    if engine_id not in ENGINE_REGISTRY:
        known = sorted(set(ENGINE_REGISTRY) | MULTI_SPEAKER_ENGINES)
        raise KeyError(f"unknown engine {engine_id!r}; known: {known}")
    if sid is not None:
        raise ValueError(f"{engine_id} is single-speaker; --sid not accepted")
    return ENGINE_REGISTRY[engine_id]()
