"""Engine registry — maps engine id to (factory, language).

Engine ids are stable identifiers used in CLI args, result files, and the
report; renaming one invalidates cached results.
"""

from collections.abc import Callable

from .base import SttEngine
from .elevenlabs_cloud import ElevenLabsCloudEngine
from .fw_phowhisper_vi import FasterWhisperPhoWhisperVi
from .fw_whisper_small_en import FasterWhisperSmallEn
from .sherpa_moonshine_en import SherpaMoonshineEn
from .sherpa_zipformer_vi import SherpaZipformerVi

ENGINE_REGISTRY: dict[str, Callable[[], SttEngine]] = {
    "sherpa-zipformer-vi": SherpaZipformerVi,
    "sherpa-moonshine-en": SherpaMoonshineEn,
    "fw-phowhisper-vi": FasterWhisperPhoWhisperVi,
    "fw-whisper-small-en": FasterWhisperSmallEn,
    "elevenlabs-vi": lambda: ElevenLabsCloudEngine("vi"),
    "elevenlabs-en": lambda: ElevenLabsCloudEngine("en"),
}


def create_engine(engine_id: str) -> SttEngine:
    if engine_id not in ENGINE_REGISTRY:
        raise KeyError(f"unknown engine {engine_id!r}; known: {sorted(ENGINE_REGISTRY)}")
    return ENGINE_REGISTRY[engine_id]()
