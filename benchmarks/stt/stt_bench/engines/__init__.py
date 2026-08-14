"""Engine registry — maps engine id to (factory, language).

Engine ids are stable identifiers used in CLI args, result files, and the
report; renaming one invalidates cached results.
"""

from collections.abc import Callable

from .base import SttEngine
from .elevenlabs_cloud import ElevenLabsCloudEngine
from .fw_large_turbo import FasterWhisperLargeTurbo
from .fw_phowhisper_vi import FasterWhisperPhoWhisperVi
from .fw_whisper_small_en import FasterWhisperSmallEn
from .parakeet_nemotron import ParakeetNemotron
from .sherpa_moonshine_en import SherpaMoonshineEn
from .sherpa_zipformer_vi import SherpaZipformerVi

#: Quantizations published for the streaming model, smallest first. Swept rather
#: than assumed: the usual claim is that q8_0 is free accuracy, and this machine
#: has the RAM to run f16 if it is not.
NEMOTRON_QUANTS = ("q4_k", "q5_k", "q6_k", "q8_0", "f16")

ENGINE_REGISTRY: dict[str, Callable[[], SttEngine]] = {
    "sherpa-zipformer-vi": SherpaZipformerVi,
    "sherpa-moonshine-en": SherpaMoonshineEn,
    "fw-phowhisper-vi": FasterWhisperPhoWhisperVi,
    "fw-whisper-small-en": FasterWhisperSmallEn,
    "elevenlabs-vi": lambda: ElevenLabsCloudEngine("vi"),
    "elevenlabs-en": lambda: ElevenLabsCloudEngine("en"),
    "fw-large-turbo-vi": lambda: FasterWhisperLargeTurbo("vi"),
    "fw-large-turbo-en": lambda: FasterWhisperLargeTurbo("en"),
    **{
        f"parakeet-nemotron-{quant}-{mode}-{lang}": (
            lambda lang=lang, quant=quant, mode=mode: ParakeetNemotron(
                lang, quant, mode
            )
        )
        for lang in ("vi", "en")
        for quant in NEMOTRON_QUANTS
        for mode in ("offline", "stream")
    },
}


def create_engine(engine_id: str) -> SttEngine:
    if engine_id not in ENGINE_REGISTRY:
        raise KeyError(f"unknown engine {engine_id!r}; known: {sorted(ENGINE_REGISTRY)}")
    return ENGINE_REGISTRY[engine_id]()
