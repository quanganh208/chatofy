"""Language to engine resolution.

Both engines load eagerly at startup so /healthz is honest about readiness and
the first request has no load spike. Cost depends on the Vietnamese engine: ~640MB
with `zipformer`, ~1.4GB with `nemotron` (a ~1GB GGUF).

The language set is closed on purpose: `@chatofy/types` defines
`languageCodeSchema = z.enum(['vi', 'en'])`, so anything else is a caller bug,
not a missing feature.
"""
import os

from .base import SttEngine, preload_onnxruntime_dll
from .moonshine_en import MoonshineEn
from .nemotron_vi import NemotronVi
from .zipformer_vi import ZipformerVi

#: Vietnamese has two engines with a real trade-off, so the choice is config.
#:
#: `nemotron` is the streaming recognizer the mid-utterance commit path needs —
#: its prefix is monotone by construction. `zipformer` is ~7-9 WER points better
#: but re-decodes the whole buffer, so it revises words already spoken aloud.
#: Rolling back is this one value; nothing else in the service knows which is
#: loaded. English has no such choice and is not configurable.
_VI_ENGINES: dict[str, type[SttEngine]] = {
    "nemotron": NemotronVi,
    "zipformer": ZipformerVi,
}
_VI_DEFAULT = "nemotron"


class UnknownEngineError(Exception):
    """Raised at startup for a LOCAL_STT_VI_ENGINE value with no engine."""


def _vi_engine_type() -> type[SttEngine]:
    name = os.environ.get("LOCAL_STT_VI_ENGINE", _VI_DEFAULT)
    engine_type = _VI_ENGINES.get(name)
    if engine_type is None:
        raise UnknownEngineError(
            f"unknown LOCAL_STT_VI_ENGINE {name!r}; expected one of {tuple(_VI_ENGINES)}"
        )
    return engine_type


def _engine_types() -> dict[str, type[SttEngine]]:
    """Resolved at load time, not import time, so the config value is readable
    from a test or a shell without reimporting the module."""
    return {"vi": _vi_engine_type(), "en": MoonshineEn}


#: The language set is closed on purpose; which engine serves `vi` is not part
#: of it, so this stays a plain tuple rather than a view over the engine map.
SUPPORTED_LANGUAGES = ("vi", "en")


class UnsupportedLanguageError(Exception):
    """Raised for a language outside SUPPORTED_LANGUAGES. Maps to HTTP 400."""


class EngineRegistry:
    def __init__(self) -> None:
        self._engines: dict[str, SttEngine] = {}

    def load_all(self) -> None:
        # Must precede every `import sherpa_onnx`, which happens inside each
        # engine's load(). See base.preload_onnxruntime_dll for why.
        preload_onnxruntime_dll()
        for lang, engine_type in _engine_types().items():
            engine = engine_type()
            engine.load()
            self._engines[lang] = engine

    def unload_all(self) -> None:
        self._engines.clear()

    @property
    def ready(self) -> bool:
        return len(self._engines) == len(SUPPORTED_LANGUAGES) and all(
            engine.loaded for engine in self._engines.values()
        )

    def get(self, lang: str) -> SttEngine:
        engine = self._engines.get(lang)
        if engine is None:
            if lang not in SUPPORTED_LANGUAGES:
                raise UnsupportedLanguageError(
                    f"unsupported language {lang!r}; expected one of {SUPPORTED_LANGUAGES}"
                )
            raise RuntimeError(f"{lang} engine not loaded")
        return engine
