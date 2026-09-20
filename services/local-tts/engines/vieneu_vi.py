"""Vietnamese TTS — VieNeu v3 Turbo (ONNX/CPU, torch-free).

Different runtime from the English voice: the `vieneu` package owns its own
inference stack, so this engine does not touch sherpa-onnx. Cold start is
~8s and the first ever run downloads the model.
"""
import importlib.util
import json
from pathlib import Path

import numpy as np

from .base import TtsEngine, VoiceEntry

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

    def _infer(self, text: str, voice: int | str, speed: float) -> tuple[np.ndarray, int]:
        # VieNeu has no speed control; `speed` is accepted for contract
        # symmetry with the English engine and ignored here.
        samples = np.asarray(
            self._engine.infer(text, voice=str(voice)), dtype=np.float32
        )
        return samples, self._engine.sample_rate
