"""Vietnamese TTS — VieNeu v3 Turbo (ONNX/CPU, torch-free).

Different runtime from the English voice: the `vieneu` package owns its own
inference stack, so this engine does not touch sherpa-onnx. Cold start is
~8s and the first ever run downloads the model.
"""
import importlib.util
import json
from collections.abc import Iterator
from pathlib import Path

import numpy as np

from .base import DEFAULT_GENDER, TtsEngine, VoiceEntry

#: The package's own preset manifest, relative to the installed `vieneu` package.
#: It is the list the runtime resolves `voice=` against, so reading it is how the
#: catalog stays true to whatever version is installed.
MANIFEST = Path("assets") / "voices_v3_turbo.json"


def _package_catalog() -> tuple[VoiceEntry, ...]:
    """Every preset the installed package ships, read from its manifest.

    The manifest declares `gender` (and usually `region`) per preset, which is
    what makes listing all of them possible at all. The earlier catalog stopped
    at two because gender was believed to be an audition result — true of the
    English engine, where sherpa-onnx exposes nothing but integers, and false
    here: the package states it, alongside the region and reading style each
    preset was built for.

    Located through `find_spec` rather than by importing `vieneu`, because this
    runs at import time and the package pulls in an inference stack.

    Returns an empty tuple when anything about the manifest is not as expected.
    The class below falls back to the two auditioned presets in that case: a
    package that reorganises its assets should cost the picker its long list,
    never the service its voices.

    **The whole walk is inside the guard, not just the read.** `CATALOG` is built
    at import (see below), so an exception escaping here is not a degraded picker
    — it is a service that will not start, over a list of names. Reading and
    parsing were guarded while `presets.items()` and `meta.get` were not, which
    covered a missing or corrupt file and left the shapes that parse cleanly and
    are the wrong type: a `presets` that is a list, an entry that is a bare
    string. Those are exactly what "reorganises its assets" looks like.

    The types are still named rather than caught wholesale: a `MemoryError` or a
    `RecursionError` is not a manifest that disappointed us, and reporting either
    as two default voices would hide a fault of the machine behind a fault of the
    package.
    """
    spec = importlib.util.find_spec("vieneu")
    if spec is None or spec.origin is None:
        return ()

    entries = []
    try:
        presets = json.loads(
            (Path(spec.origin).parent / MANIFEST).read_text(encoding="utf-8")
        )["presets"]
        for name, meta in presets.items():
            gender = meta.get("gender")
            # A preset this service cannot state the gender of is left out rather
            # than guessed: gender picks the default voice, so a wrong one is a
            # silent switch to the other speaker.
            if gender not in ("female", "male"):
                continue
            entries.append(
                VoiceEntry(token=name, label=_label(name, meta), gender=gender)
            )
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return ()

    return tuple(entries)


def _label(name: str, meta: dict) -> str:
    """The preset's name, plus its region where the manifest gives one.

    Region is not decoration in Vietnamese — a northern and a southern voice
    reading the same sentence differ in a way a listener notices immediately, and
    it is the first thing anyone picking from twenty names wants to know. Some
    entries carry it only inside `description` ("Nữ · Bắc · Phong cách tự nhiên"),
    hence the second read; a preset that states it nowhere is listed by name
    alone rather than with a guessed one.
    """
    region = meta.get("region")
    if not region:
        parts = [part.strip() for part in str(meta.get("description", "")).split("·")]
        region = parts[1] if len(parts) > 2 else ""
    return f"{name} · {region}" if region else name


#: VieNeu preset names, chosen by listening to every preset the package shipped at
#: the time (14; it now ships 25). "Thanh Bình" reads as unisex and is male —
#: these are audition results, not inferences from the names.
#:
#: They stay hand-picked even though the catalog is generated: this pair is what a
#: caller who names no voice at all is spoken with, on every turn, which is a
#: listening decision rather than a data one.
DEFAULTS = {"female": "Mai Anh", "male": "Thanh Bình"}

#: The seed each default voice speaks with, on both endpoints.
#:
#: VieNeu samples every frame from the global numpy RNG, so an unseeded engine
#: draws a different rendition of the same sentence on every call — and how
#: intelligible that rendition is swings with the draw: the same 41 sentences
#: scored 6.4-13.4% WER for Mai Anh and 13.8-24.9% for Thanh Bình across eight
#: seeds (vieneu 3.8.1, PhoWhisper-small). A fixed seed makes the voice
#: reproducible; choosing it makes it the good draw rather than an arbitrary one.
#:
#: Chosen as the lowest-WER seed of eight on the conversational set, kept only
#: if it also beat the median seed on the held-out VIVOS set. Mai Anh's best
#: (11) did; Thanh Bình's best (11) lost to its median seed there by 0.2pp, so
#: it takes its second-best, 44, which won the held-out check by 5pp.
#: `benchmarks/tts-vi/results/seed-sensitivity/summary-vieneu-vi-*.json`.
#:
#: Other catalog voices take their gender's entry (see `_seed`). That transfer
#: is untested per voice: a seed is a property of voice and draw together.
SEEDS = {"Mai Anh": 11, "Thanh Bình": 44}


def _catalog() -> tuple[VoiceEntry, ...]:
    """The manifest's presets, defaults first, or just the defaults."""
    entries = _package_catalog() or tuple(
        VoiceEntry(token=name, label=name, gender=gender)
        for gender, name in DEFAULTS.items()
    )
    # The two voices this engine speaks with by default lead a list of twenty,
    # so the familiar ones are not buried among eighteen unheard names.
    return tuple(sorted(entries, key=lambda entry: entry.token not in DEFAULTS.values()))


class VieNeuVi(TtsEngine):
    lang = "vi"
    VOICES = DEFAULTS
    #: Every preset the installed package publishes — see `_package_catalog`.
    CATALOG = _catalog()

    def load(self) -> None:
        from vieneu import Vieneu

        self._engine = Vieneu(
            mode="v3turbo",  # CPU → torch-free ONNX
            # fp32 is the graph these voices were auditioned on. Up to 3.3.0 the
            # package defaulted to int8 and this pin was a correction; 3.4.0 made
            # fp32 the default, so it now states a choice. Kept as-is because
            # swapping needs a listening comparison, and the benchmark that could
            # justify one measured int8 ~1.5x faster with intelligibility it did
            # not separate — see this service's README.
            precision="fp32",
            threads=self._threads,
        )

    @property
    def sample_rate(self) -> int:
        return self._engine.sample_rate

    def _seed(self, voice: str) -> int:
        """The seed this voice speaks with — its own if swept, else its gender's.

        `voice` is the token `_resolve` returned, never a raw client value, so
        it is always a catalog entry or a default.
        """
        if voice in SEEDS:
            return SEEDS[voice]
        gender = next(
            (entry.gender for entry in self.CATALOG if entry.token == voice),
            DEFAULT_GENDER,
        )
        return SEEDS[DEFAULTS[gender]]

    def _infer(self, text: str, voice: int | str, speed: float) -> tuple[np.ndarray, int]:
        # VieNeu has no speed control; `speed` is accepted for contract
        # symmetry with the English engine and ignored here.
        np.random.seed(self._seed(str(voice)))
        samples = np.asarray(
            self._engine.infer(text, voice=str(voice)), dtype=np.float32
        )
        return samples, self._engine.sample_rate

    def _infer_stream(
        self, text: str, voice: int | str, speed: float
    ) -> Iterator[np.ndarray]:
        """The package's own frame-level stream, over the whole turn.

        Seeded HERE, immediately before the first frame is drawn: `infer_stream`
        is a lazy generator that samples from the global numpy RNG as it is
        iterated, so a seed set anywhere earlier is open to whatever else draws
        in between. The caller holds the engine lock for the whole iteration,
        which is what keeps a second stream from drawing from the same RNG
        mid-turn.

        Acoustic tokens match `infer` under the same seed; chunk boundaries do
        not, because the package sizes them from `time.perf_counter()`. Pauses
        between sentences are padded in by the package itself (3.8.1).
        """
        np.random.seed(self._seed(str(voice)))
        for samples in self._engine.infer_stream(text, voice=str(voice)):
            yield np.asarray(samples, dtype=np.float32).reshape(-1)
