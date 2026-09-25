"""Language to engine resolution.

Both engines load eagerly at startup (~1.5GB resident) so /healthz is honest
about readiness and the first request has no load spike.

One engine per language answers both the live re-reads and the settled
transcript. English is Parakeet-TDT: on real prod turns it halved Moonshine's
WER, and it keeps up with the 300ms re-read cadence under two-speaker load
(see docs/development-journey.md).

The language set is closed on purpose: `@chatofy/types` defines
`languageCodeSchema = z.enum(['vi', 'en'])`, so anything else is a caller bug,
not a missing feature.
"""
from .base import SttEngine, preload_onnxruntime_dll
from .parakeet_en import ParakeetEn
from .zipformer_vi import ZipformerVi

_ENGINE_TYPES: dict[str, type[SttEngine]] = {
    "vi": ZipformerVi,
    "en": ParakeetEn,
}

SUPPORTED_LANGUAGES = tuple(_ENGINE_TYPES)


class UnsupportedLanguageError(Exception):
    """Raised for a language outside SUPPORTED_LANGUAGES. Maps to HTTP 400."""


class EngineRegistry:
    def __init__(self) -> None:
        self._engines: dict[str, SttEngine] = {}

    def load_all(self) -> None:
        # Must precede every `import sherpa_onnx`, which happens inside each
        # engine's load(). See base.preload_onnxruntime_dll for why.
        preload_onnxruntime_dll()
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

    def get(self, lang: str) -> SttEngine:
        engine = self._engines.get(lang)
        if engine is None:
            if lang not in _ENGINE_TYPES:
                raise UnsupportedLanguageError(
                    f"unsupported language {lang!r}; expected one of {SUPPORTED_LANGUAGES}"
                )
            raise RuntimeError(f"{lang} engine not loaded")
        return engine
