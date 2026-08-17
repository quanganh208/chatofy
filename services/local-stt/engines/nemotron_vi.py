"""Vietnamese STT — nvidia/nemotron-3.5-asr-streaming-0.6b via parakeet.cpp.

Replaces Zipformer on the Vietnamese side for one reason: its prefix is monotone
by construction. Decoding is cache-aware and causal, so audio already consumed is
never re-decoded and text already spoken can never be revised. Zipformer, decoded
offline over a growing buffer, overturned 66 and 38 already-emitted words on real
disfluent speech — unusable when the output is played as audio you cannot recall.

Measured on this machine against the same fixtures and references as Zipformer:

    WER  20.4% / 26.1%  (Zipformer 11.7% / 19.3%)
    RTF  0.07 offline, 0.19 streaming   (Zipformer 0.014-0.016)
    RAM  995MB resident + ~60MB per streaming session   (Zipformer 223MB)

The memory split matters more than the total: the 995MB is the loaded model, paid
once for the process, while a streaming session adds only ~60MB and **does not
grow with turn length** (1053MB at 5s of audio, 1059MB at 41s). Whole-utterance
decoding is the one that scales, at roughly 9MB per second of audio, so a long
turn is cheap on the streaming path and expensive on the endpoint below.

The 7-9 point WER cost is accepted deliberately in exchange for mid-utterance
playback. It is mostly deletions on hard passages, not substitutions — this model
skips what it cannot hear where Zipformer guesses.

Unlike Zipformer this one emits punctuation and casing, so `postprocess` has no
sentence-casing to do; what it must do instead is strip language tags.

LICENSE: OpenMDW-1.1.
"""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np

from .base import MODELS_DIR, SttEngine
from .parakeet_runtime import (
    ParakeetModel,
    strip_language_tags,
    strip_language_tags_delta,
)

MODEL_DIR = MODELS_DIR / "nemotron-streaming-0.6b"
MODEL_FILE = "nemotron-3.5-asr-streaming-0.6b-q8_0.gguf"

#: The model's own locale string. "vi" alone is rejected by the prompt lookup.
TARGET_LANG = "vi-VN"

class NemotronVi(SttEngine):
    lang = "vi"
    supports_streaming = True

    def load(self) -> None:
        path = Path(os.environ.get("LOCAL_STT_NEMOTRON_GGUF", MODEL_DIR / MODEL_FILE))
        self._recognizer = ParakeetModel(path)

    def postprocess(self, text: str) -> str:
        """Strip the decoder's language-tag markers before anything speaks this.

        Lives in `parakeet_runtime` so the benchmark harness, which drives the
        binding directly, applies the identical filter. It did not, once, and the
        measured WER came back 22 points worse than the model deserved.
        """
        return strip_language_tags(text)

    def postprocess_delta(self, text: str) -> str:
        """The same filter, minus the trim that would glue words together.

        This engine emits pieces, and the space in front of a piece is what
        says a new word began.
        """
        return strip_language_tags_delta(text)

    def transcribe(self, samples: np.ndarray) -> str:
        if self._recognizer is None:
            raise RuntimeError(f"{self.lang} engine not loaded")
        # Same lock discipline as the sherpa engines: one warm model, sync
        # endpoint on FastAPI's threadpool, so concurrent calls must serialize.
        with self._lock:
            raw = self._recognizer.transcribe(samples, TARGET_LANG)
        return self.postprocess(raw)

    def stream(self):
        """Open a streaming session. Callers append what `feed` returns.

        This is the entry point the mid-utterance commit path uses; the HTTP
        endpoint above stays whole-utterance and unchanged.
        """
        if self._recognizer is None:
            raise RuntimeError(f"{self.lang} engine not loaded")
        return self._recognizer.stream(TARGET_LANG)
