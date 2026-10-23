"""Language to engine resolution.

Every engine loads eagerly at startup (~1.9GB resident: vi ~0.2GB, en ~1.1GB,
zh ~0.4GB, plus the runtime) so /healthz is honest about readiness and the
first request has no load spike. The optional vi alternate adds ~0.1GB after
load and ~0.4GB at a four-lane peak; the optional language identifier
(`lid.model_decider`) ~0.6GB at a four-lane peak.

One engine per language answers both the live re-reads and the settled
transcript. English is Parakeet-TDT: on real prod turns it halved Moonshine's
WER, and it keeps up with the 300ms re-read cadence under two-speaker load
(see docs/development-journey.md).

`SUPPORTED_LANGUAGES` need not equal every code `@chatofy/types` registers — it
is a SUBSET of the TS registry, and parity between the two is checked at
RUNTIME by the API's `SpeechLanguageSupport`, which reads `/healthz`'s
`languages` field rather than trusting a generated list that could drift from
what actually loaded. A code outside `SUPPORTED_LANGUAGES` is still a 400 from
`EngineRegistry.get`, same as before; a registry code this sidecar does not
serve is the API's refusal to make, before the audio ever reaches here.
"""
import logging

from lid.decider import IDENTIFIABLE, lid_enabled
from lid.model_decider import WhisperLanguageId

from .base import SttEngine, preload_onnxruntime_dll
from .paraformer_zh import ParaformerZh
from .parakeet_en import ParakeetEn
from .zipformer_vi import ZipformerVi
from .zipformer_vi_alternate import ZipformerViAlternate

logger = logging.getLogger(__name__)

_ENGINE_TYPES: dict[str, type[SttEngine]] = {
    "vi": ZipformerVi,
    "en": ParakeetEn,
    "zh": ParaformerZh,
}

#: A second recognizer per language whose reading rides beside the primary
#: one on `/transcribe?alternates=true`. OPTIONAL, unlike `_ENGINE_TYPES`: one
#: that is not seeded or fails to load is a warning, and neither `ready` nor
#: `/healthz` ever depends on it — the display without it is today's display.
_ALTERNATE_TYPES: dict[str, type[ZipformerViAlternate]] = {
    "vi": ZipformerViAlternate,
}

SUPPORTED_LANGUAGES = tuple(_ENGINE_TYPES)


class UnsupportedLanguageError(Exception):
    """Raised for a language outside SUPPORTED_LANGUAGES. Maps to HTTP 400."""


class EngineRegistry:
    def __init__(self) -> None:
        self._engines: dict[str, SttEngine] = {}
        self._alternates: dict[str, SttEngine] = {}
        self._lid: WhisperLanguageId | None = None

    def load_all(self) -> None:
        # Must precede every `import sherpa_onnx`, which happens inside each
        # engine's load(). See base.preload_onnxruntime_dll for why.
        preload_onnxruntime_dll()
        for lang, engine_type in _ENGINE_TYPES.items():
            engine = engine_type()
            engine.load()
            self._engines[lang] = engine
        # After the primaries, so a failure here can never be mistaken for one
        # of theirs, and a slow load never delays the engines readiness needs.
        for lang, alternate_type in _ALTERNATE_TYPES.items():
            if not alternate_type.weights_present():
                logger.warning(
                    "%s alternate recognizer not seeded; serving without alternates", lang
                )
                continue
            alternate = alternate_type()
            try:
                alternate.load()
            except Exception:  # noqa: BLE001 — an alternate must never stop the sidecar
                logger.exception(
                    "%s alternate recognizer failed to load; serving without alternates", lang
                )
                continue
            self._alternates[lang] = alternate
        # Optional in the same way: without it, a request naming candidates is
        # refused and every other request is served as before.
        if not lid_enabled():
            return
        if not WhisperLanguageId.weights_present():
            logger.warning("language identifier not seeded; candidates will be refused")
            return
        lid = WhisperLanguageId()
        try:
            lid.load()
        except Exception:  # noqa: BLE001 — identification must never stop the sidecar
            logger.exception("language identifier failed to load; candidates will be refused")
            return
        self._lid = lid

    def unload_all(self) -> None:
        self._engines.clear()
        self._alternates.clear()
        if self._lid is not None:
            self._lid.unload()
        self._lid = None

    @property
    def ready(self) -> bool:
        return len(self._engines) == len(_ENGINE_TYPES) and all(
            engine.loaded for engine in self._engines.values()
        )

    @property
    def alternate_languages(self) -> list[str]:
        """Languages whose alternate recognizer loaded. Reported, never gating."""
        return [lang for lang, engine in self._alternates.items() if engine.loaded]

    @property
    def lid(self) -> WhisperLanguageId | None:
        """The loaded language identifier, or None when off, unseeded or failed."""
        return self._lid if self._lid is not None and self._lid.loaded else None

    @property
    def lid_languages(self) -> list[str]:
        """Languages a request's `candidates` may name; empty without an identifier."""
        return [lang for lang in IDENTIFIABLE if lang in self._engines] if self.lid is not None else []

    def alternate(self, lang: str) -> SttEngine | None:
        """The loaded alternate recognizer for `lang`, or None when it has none."""
        engine = self._alternates.get(lang)
        return engine if engine is not None and engine.loaded else None

    def get(self, lang: str) -> SttEngine:
        engine = self._engines.get(lang)
        if engine is None:
            if lang not in _ENGINE_TYPES:
                raise UnsupportedLanguageError(
                    f"unsupported language {lang!r}; expected one of {SUPPORTED_LANGUAGES}"
                )
            raise RuntimeError(f"{lang} engine not loaded")
        return engine
