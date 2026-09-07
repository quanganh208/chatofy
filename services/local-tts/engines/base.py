"""Shared engine contract for the TTS sidecar.

Mirrors `services/local-stt/engines/base.py`. The two voices run on different
runtimes — Kokoro through sherpa-onnx, Vietnamese through the vieneu package —
so this base only fixes what they genuinely share: eager loading, a lock, and
a `synthesize` that returns samples plus their rate.

Callers ask for a voice by GENDER, which is the only way to name a voice that
means the same thing to two unrelated runtimes. Each engine owns the tokens
that gender resolves to — a speaker id for Kokoro, a preset name for VieNeu —
and nothing outside this service names those values.
"""
import os
import sys
import threading
from abc import ABC, abstractmethod
from collections.abc import Mapping
from pathlib import Path
from typing import ClassVar, NamedTuple

import numpy as np

#: Used when the caller names no gender, or names one this engine has no voice
#: for. Matches the default in the app's wire contract.
DEFAULT_GENDER = "female"

SERVICE_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = SERVICE_ROOT / "models"


def tts_threads() -> int:
    """CPU threads per engine. 8 (physical cores) beat 16 (hyperthreads) here."""
    return int(os.environ.get("LOCAL_TTS_THREADS", "8"))


def preload_onnxruntime_dll() -> None:
    """Load the venv's onnxruntime.dll before sherpa-onnx native code runs.

    The sherpa-onnx Windows wheel does not bundle onnxruntime.dll; without this
    the loader resolves the name via PATH and finds the Windows ML build in
    System32 (reports ORT 1.17.1), which lacks the C API version sherpa-onnx
    was built against — the process then dies with a hard abort, not a Python
    exception. Preloading pins the name to the correct in-process module.

    Must run before any `import sherpa_onnx`.
    """
    if sys.platform != "win32":
        return
    import ctypes

    import onnxruntime

    capi_dir = Path(onnxruntime.__file__).parent / "capi"
    ctypes.WinDLL(str(capi_dir / "onnxruntime.dll"))


class VoiceEntry(NamedTuple):
    """One voice a caller may ask for by name.

    `token` is this engine's own address for the voice — a speaker id for one
    runtime, a preset name for another — and is opaque everywhere outside this
    service. `label` is what a person reads, and it is an AUDITION RESULT: it is
    written by someone who listened, never inferred from the token.
    """

    token: str
    label: str
    gender: str


class TtsEngine(ABC):
    """One loaded language, speakable in either gender."""

    lang: str
    #: Gender to the token this engine's runtime addresses that voice by.
    #: Both entries are required: gender is a closed set, so a missing one
    #: would be a silent downgrade to the other voice.
    #:
    #: Deliberately NOT restructured into a list when the catalog arrived:
    #: `_voice_for` indexes this by `DEFAULT_GENDER`, so re-keying it would break
    #: the DEFAULT path — every turn in both languages, including for callers who
    #: never asked for a specific voice.
    VOICES: ClassVar[Mapping[str, int | str]]
    #: Voices this engine offers by name, for `GET /voices`.
    #:
    #: The rule is NAMEABILITY, not audition. A picker full of "Voice 9" is worse
    #: than no picker — it asks someone to choose between things it cannot
    #: describe — so an entry needs a name and a gender this service can state
    #: rather than guess. What it does not need is for someone to have listened
    #: first, which is where this list was stuck at two voices per language while
    #: the models shipped 53 and 20.
    #:
    #: Both engines can now answer that: the Vietnamese package publishes a preset
    #: manifest carrying gender, region and style, and the English speaker ids are
    #: positions in a published, alphabetically ordered voice list pinned by two
    #: already-auditioned entries. Each engine documents its own source, because
    #: what makes a voice nameable is a property of that runtime.
    #:
    #: `VOICES` is the part audition still owns: it is what a caller who names no
    #: voice is spoken with, and nothing here changes it.
    CATALOG: ClassVar[tuple[VoiceEntry, ...]] = ()

    def __init__(self) -> None:
        self._engine = None
        self._threads = tts_threads()
        self._lock = threading.Lock()

    @abstractmethod
    def load(self) -> None:
        """Build the engine. Called once at startup."""

    @abstractmethod
    def _infer(self, text: str, voice: int | str, speed: float) -> tuple[np.ndarray, int]:
        """Synthesize with an already-resolved voice token, under the caller's
        lock. Returns (samples, sample_rate)."""

    @property
    def loaded(self) -> bool:
        return self._engine is not None

    def _voice_for(self, gender: str | None) -> int | str:
        """Resolve a requested gender to this engine's voice token.

        An unrecognised gender falls back instead of raising: /translate is a
        public API, and a strange value should not cost the caller their audio.
        """
        return self.VOICES.get(gender or DEFAULT_GENDER, self.VOICES[DEFAULT_GENDER])

    def _resolve(self, voice: str | None, gender: str | None) -> int | str:
        """Pick the voice to speak with, preferring a named one.

        A client-supplied token survives ONLY if this engine's own catalog lists
        it. That whitelist is the enforcement, and it has to live here rather than
        in a caller: `_infer` hands the token straight to the runtime, where an
        unrecognised value is not a graceful failure — one engine coerces it with
        `int()` and raises, the other passes an arbitrary string into a package
        that has no idea what to do with it.

        Anything unrecognised falls back to the gender default instead of raising.
        Rejecting is the wrong answer for the same reason it is for `gender`: a
        stale token from an older build, or a catalog that changed underneath a
        saved preference, should cost someone their VOICE — not their audio. That
        rule is what fixed a real outage, where a voice name meant for one backend
        reached another and every turn in one language failed.
        """
        if voice is not None:
            for entry in self.CATALOG:
                if entry.token == voice:
                    return self._voice_token(entry)
        return self._voice_for(gender)

    def _voice_token(self, entry: VoiceEntry) -> int | str:
        """Catalog token in the form this runtime addresses voices by.

        Overridden where the runtime wants something other than a string — the
        English engine addresses voices by integer id.
        """
        return entry.token

    def synthesize(
        self,
        text: str,
        gender: str | None = None,
        speed: float = 1.0,
        voice: str | None = None,
    ) -> tuple[np.ndarray, int]:
        if self._engine is None:
            raise RuntimeError(f"{self.lang} engine not loaded")
        # Sync endpoints run in FastAPI's threadpool; the lock serializes
        # concurrent calls against the single warm engine.
        with self._lock:
            return self._infer(text, self._resolve(voice, gender), speed)
