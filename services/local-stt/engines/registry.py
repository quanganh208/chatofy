"""(language, pass) to engine resolution.

Engines load eagerly at startup so /healthz is honest about readiness and the
first request has no load spike.

The language set is closed on purpose: `@chatofy/types` defines
`languageCodeSchema = z.enum(['vi', 'en'])`, so anything else is a caller bug,
not a missing feature.

A request is either a live PARTIAL (the growing turn, re-read every 300ms) or
the FINAL transcript of a finished turn. They are separate because the best
final model and the cheapest re-read model are not the same model in English:
Parakeet-TDT halves English WER on real turns but costs ~1.5x Moonshine per
decode, which the 300ms partial cadence cannot absorb. Vietnamese has one
engine for both — no candidate beat Zipformer-30M per turn (see
docs/development-journey.md).

`LOCAL_STT_EN_FINAL=moonshine` puts English finals back on Moonshine and leaves
Parakeet unloaded — the rollback, with no code change.
"""
import os

from .base import SttEngine, preload_onnxruntime_dll
from .moonshine_en import MoonshineEn
from .parakeet_en import ParakeetEn
from .zipformer_vi import ZipformerVi

SUPPORTED_LANGUAGES = ("vi", "en")
SUPPORTED_PASSES = ("final", "partial")

_EN_FINAL_ENGINES: dict[str, type[SttEngine]] = {
    "parakeet": ParakeetEn,
    "moonshine": MoonshineEn,
}


class UnsupportedLanguageError(Exception):
    """Raised for a language outside SUPPORTED_LANGUAGES. Maps to HTTP 400."""


class UnsupportedPassError(Exception):
    """Raised for a pass outside SUPPORTED_PASSES. Maps to HTTP 400."""


def en_final_choice() -> str:
    """Which engine answers English finals. Anything unknown is a config typo,
    and refusing to start says so louder than silently falling back would."""
    choice = os.environ.get("LOCAL_STT_EN_FINAL", "parakeet")
    if choice not in _EN_FINAL_ENGINES:
        raise ValueError(
            f"LOCAL_STT_EN_FINAL={choice!r}; expected one of {tuple(_EN_FINAL_ENGINES)}"
        )
    return choice


def _routing() -> dict[tuple[str, str], type[SttEngine]]:
    return {
        ("vi", "final"): ZipformerVi,
        ("vi", "partial"): ZipformerVi,
        ("en", "final"): _EN_FINAL_ENGINES[en_final_choice()],
        ("en", "partial"): MoonshineEn,
    }


class EngineRegistry:
    def __init__(self) -> None:
        self._routes: dict[tuple[str, str], SttEngine] = {}

    def load_all(self) -> None:
        # Must precede every `import sherpa_onnx`, which happens inside each
        # engine's load(). See base.preload_onnxruntime_dll for why.
        preload_onnxruntime_dll()
        # One instance per engine TYPE, shared by every route that names it: a
        # second Moonshine for the rollback case would double its weights and
        # split its decode lanes in two.
        instances: dict[type[SttEngine], SttEngine] = {}
        routes: dict[tuple[str, str], SttEngine] = {}
        for key, engine_type in _routing().items():
            if engine_type not in instances:
                engine = engine_type()
                engine.load()
                instances[engine_type] = engine
            routes[key] = instances[engine_type]
        self._routes = routes

    def unload_all(self) -> None:
        self._routes.clear()

    @property
    def ready(self) -> bool:
        return len(self._routes) == len(SUPPORTED_LANGUAGES) * len(SUPPORTED_PASSES) and all(
            engine.loaded for engine in self._routes.values()
        )

    def get(self, lang: str, pass_: str = "final") -> SttEngine:
        if lang not in SUPPORTED_LANGUAGES:
            raise UnsupportedLanguageError(
                f"unsupported language {lang!r}; expected one of {SUPPORTED_LANGUAGES}"
            )
        if pass_ not in SUPPORTED_PASSES:
            raise UnsupportedPassError(
                f"unsupported pass {pass_!r}; expected one of {SUPPORTED_PASSES}"
            )
        engine = self._routes.get((lang, pass_))
        if engine is None:
            raise RuntimeError(f"{lang}/{pass_} engine not loaded")
        return engine
