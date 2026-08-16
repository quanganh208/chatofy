"""Language to engine resolution.

Engines load eagerly at startup so /healthz is honest about readiness and the
first request has no load spike.

Vietnamese runs TWO engines at once, and the reason is the whole design:

  spoken   nemotron, streaming — its prefix is append-only by construction, so
           a word handed to TTS can never be contradicted. Costs roughly double
           the word error rate.
  display  zipformer — 5.38% against nemotron's 10.93% on VIVOS-50, and it is
           allowed to be wrong for a moment because `server.translation.partial`
           replaces the whole span rather than appending to it.

Audio that has been played cannot be recalled; text on a screen can. Charging
the on-screen transcript the accuracy price of monotonicity is charging a path
that gains nothing from it. Cost of the pair: ~1.4GB plus ~223MB.

Rolling back is still one value. `LOCAL_STT_VI_ENGINE=zipformer` drops the
streaming engine entirely — nothing is loaded for a path that no longer runs —
and the service returns to one Vietnamese engine serving both roles.

The language set is closed on purpose: `@chatofy/types` defines
`languageCodeSchema = z.enum(['vi', 'en'])`, so anything else is a caller bug,
not a missing feature. Which engine serves a language is not part of that set.
"""
import os

from .base import SttEngine, preload_onnxruntime_dll
from .moonshine_en import MoonshineEn
from .nemotron_vi import NemotronVi
from .zipformer_vi import ZipformerVi

#: Vietnamese has two engines with a real trade-off, so the choice is config.
_VI_ENGINES: dict[str, type[SttEngine]] = {
    "nemotron": NemotronVi,
    "zipformer": ZipformerVi,
}
_VI_DEFAULT = "nemotron"

#: Which engine serves the on-screen transcript when it is not the spoken one.
#:
#: Not configurable, and deliberately so: there is exactly one Vietnamese engine
#: that is more accurate than the streaming one, and a knob here would only let
#: someone select the worse option for the job it exists to do better.
_VI_DISPLAY = "zipformer"

_EN_ENGINES: dict[str, type[SttEngine]] = {"moonshine": MoonshineEn}
_EN_DEFAULT = "moonshine"


class UnknownEngineError(Exception):
    """Raised for an engine name no language serves."""


def _vi_spoken_name() -> str:
    name = os.environ.get("LOCAL_STT_VI_ENGINE", _VI_DEFAULT)
    if name not in _VI_ENGINES:
        raise UnknownEngineError(
            f"unknown LOCAL_STT_VI_ENGINE {name!r}; expected one of {tuple(_VI_ENGINES)}"
        )
    return name


def _vi_engine_type() -> type[SttEngine]:
    """The engine serving Vietnamese by default — the spoken path's choice."""
    return _VI_ENGINES[_vi_spoken_name()]


def _vi_names() -> tuple[str, ...]:
    """Every Vietnamese engine to load, defaulted one first.

    One name after a rollback: with the streaming path switched off there is no
    second role to serve, and loading a 1GB model nothing will call is a cost
    with no buyer.
    """
    spoken = _vi_spoken_name()
    if spoken == _VI_DISPLAY:
        return (spoken,)
    return (spoken, _VI_DISPLAY)


def _engine_types() -> dict[str, dict[str, type[SttEngine]]]:
    """Resolved at load time, not import time, so the config value is readable
    from a test or a shell without reimporting the module."""
    return {
        "vi": {name: _VI_ENGINES[name] for name in _vi_names()},
        "en": dict(_EN_ENGINES),
    }


def _default_names() -> dict[str, str]:
    """Which engine answers a request that names none.

    Vietnamese defaults to the DISPLAY engine, not the spoken one, and the
    asymmetry is deliberate: `/transcribe` is only ever read by something with a
    screen — a live partial, a final transcript, a REST caller — and every one of
    those is free to be replaced by the next answer. The spoken path never comes
    through here at all; it opens a session and asks for the streaming engine by
    name. Defaulting the other way charged every plain transcription the accuracy
    price of a guarantee it does not use, including on `apps/web`, which does not
    stream at all.

    After a rollback both roles are the same engine and this is moot.
    """
    return {"vi": _vi_display_name(), "en": _EN_DEFAULT}


def _vi_display_name() -> str:
    """The accurate engine, unless a rollback left only the streaming one."""
    spoken = _vi_spoken_name()
    return _VI_DISPLAY if spoken != _VI_DISPLAY else spoken


#: The language set is closed on purpose; which engine serves a language is not
#: part of it, so this stays a plain tuple rather than a view over the engine map.
SUPPORTED_LANGUAGES = ("vi", "en")


class UnsupportedLanguageError(Exception):
    """Raised for a language outside SUPPORTED_LANGUAGES. Maps to HTTP 400."""


class EngineRegistry:
    def __init__(self) -> None:
        self._engines: dict[str, dict[str, SttEngine]] = {}
        self._defaults: dict[str, str] = {}

    def load_all(self) -> None:
        # Must precede every `import sherpa_onnx`, which happens inside each
        # engine's load(). See base.preload_onnxruntime_dll for why.
        preload_onnxruntime_dll()
        self._defaults = _default_names()
        for lang, by_name in _engine_types().items():
            loaded: dict[str, SttEngine] = {}
            for name, engine_type in by_name.items():
                engine = engine_type()
                engine.load()
                loaded[name] = engine
            self._engines[lang] = loaded

    def unload_all(self) -> None:
        self._engines.clear()
        self._defaults.clear()

    @property
    def ready(self) -> bool:
        """Every language serves its default engine.

        Keyed on the default rather than on every loaded engine, which is a
        narrower claim than it looks: `load_all` raises if ANY engine fails, so
        the service never reaches a state where a non-default engine is missing.
        This is the check for "has loading finished", not a degradation path.
        Making it one would mean catching per-engine failures in `load_all`, and
        that is a decision about whether a screen-accuracy regression should be
        silent — it should not, so it stays a hard failure.
        """
        if len(self._engines) != len(SUPPORTED_LANGUAGES):
            return False
        return all(
            (engine := self._engines.get(lang, {}).get(self._defaults.get(lang, "")))
            is not None
            and engine.loaded
            for lang in SUPPORTED_LANGUAGES
        )

    def get(self, lang: str, engine: str | None = None) -> SttEngine:
        """The engine for a language, or a named one when the caller has a role
        in mind. An unknown name is an error rather than a silent fallback: a
        caller that asked for the accurate engine and quietly got the other one
        would produce a worse transcript with nothing anywhere saying why."""
        by_name = self._engines.get(lang)
        if by_name is None:
            if lang not in SUPPORTED_LANGUAGES:
                raise UnsupportedLanguageError(
                    f"unsupported language {lang!r}; expected one of {SUPPORTED_LANGUAGES}"
                )
            raise RuntimeError(f"{lang} engine not loaded")

        name = engine or self._defaults.get(lang, "")
        resolved = by_name.get(name)
        if resolved is None:
            raise UnknownEngineError(
                f"no engine {name!r} for {lang!r}; loaded: {tuple(by_name)}"
            )
        return resolved

    def spoken(self, lang: str) -> SttEngine:
        """The engine whose output is played aloud.

        Named separately from {@link get} because the default went the other way:
        an unnamed request wants the accurate engine, and only the streaming path
        wants this one. Asking `get(lang)` here would open a session on the
        display engine and be refused for not being causal — correctly, and
        confusingly.
        """
        if lang == "vi":
            return self.get(lang, _vi_spoken_name())
        return self.get(lang)
