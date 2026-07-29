"""Language to engine resolution.

Symmetric with `services/local-stt/engines/registry.py`. Both voices load
eagerly at startup so /healthz is honest about readiness and the first request
has no load spike — VieNeu's ~8s cold start in particular must not land on a
user's first turn.

The language set is closed on purpose: `@chatofy/types` defines
`languageCodeSchema = z.enum(['vi', 'en'])`, so anything else is a caller bug,
not a missing feature.
"""
from .base import TtsEngine
from .kokoro_en import KokoroEn
from .vieneu_vi import VieNeuVi

_ENGINE_TYPES: dict[str, type[TtsEngine]] = {
    "en": KokoroEn,
    "vi": VieNeuVi,
}

SUPPORTED_LANGUAGES = tuple(_ENGINE_TYPES)


class UnsupportedLanguageError(Exception):
    """Raised for a language outside SUPPORTED_LANGUAGES. Maps to HTTP 400."""


class EngineRegistry:
    def __init__(self) -> None:
        self._engines: dict[str, TtsEngine] = {}

    def load_all(self) -> None:
        for lang, engine_type in _ENGINE_TYPES.items():
            engine = engine_type()
            engine.load()
            self._engines[lang] = engine

    def unload_all(self) -> None:
        self._engines.clear()

    @property
    def ready(self) -> bool:
        return len(self._engines) == len(_ENGINE_TYPES) and all(
            engine.loaded for engine in self._engines.values()
        )

    def get(self, lang: str) -> TtsEngine:
        engine = self._engines.get(lang)
        if engine is None:
            if lang not in _ENGINE_TYPES:
                raise UnsupportedLanguageError(
                    f"unsupported language {lang!r}; expected one of {SUPPORTED_LANGUAGES}"
                )
            raise RuntimeError(f"{lang} engine not loaded")
        return engine
