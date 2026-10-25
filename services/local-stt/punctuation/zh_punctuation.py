"""Punctuation for the Chinese DISPLAY transcript.

Paraformer writes no punctuation at all, so a zh line on screen was one
unbroken run of characters. sherpa-onnx's CT-Transformer punctuation model
(`sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8`, from
FunASR) adds `，。？！、` between the characters it was given.

**It inserts marks; it is not trusted to.** The API keeps a restore only when
its words are the recognizer's words (`restoreKeepsWords`, which reads each Han
character as a word), so a model revision that changed a character costs that
line its punctuation, never its text. Measured here: it drops the space between
a Han character and a Latin token (`八零二点一一 a 八零二点一一 b` →
`八零二点一一a八零二点一一b`), which the guard reads as the same words but the
display then shows as `802.11a802.11b`. So every space the recognizer wrote is
put back (`_keep_spaces`): the model adds marks, and nothing else changes.

Same surface as `DisplayRestorer`, so the app routes by language and nothing
else changes. `context`, `terms` and `pauses` are accepted and ignored: the
model reads text alone, and Chinese has no casing for terms to fix.
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path

from engines.base import MODELS_DIR
from punctuation.restorer import LOCK_WAIT_S, RESTORE_THREADS, RestorerBusyError

#: Where `scripts/download_models.py` puts the model.
MODEL_DIRNAME = "sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8"
MODEL_FILE = "model.int8.onnx"

log = logging.getLogger(__name__)

#: Marks the model inserts. Chinese writes no space after one of these, so a
#: recognizer space that now follows one is dropped rather than doubled.
_FULL_WIDTH_MARKS = frozenset("，。？！、；：")


def _keep_spaces(source: str, punctuated: str) -> str:
    """`punctuated` with every space of `source` back in place.

    Walks both strings: each character of `source` is found again in
    `punctuated`, and whatever lies before it there is an inserted mark. If the
    model changed a character, nothing here can be trusted to line up, so its
    output is returned as is (the API's word guard then decides).
    """
    out: list[str] = []
    j = 0
    for ch in source:
        if ch.isspace():
            if j < len(punctuated) and punctuated[j].isspace():
                j += 1
            if out and out[-1] not in _FULL_WIDTH_MARKS and not out[-1].isspace():
                out.append(" ")
            continue
        start = j
        while j < len(punctuated) and punctuated[j] != ch:
            j += 1
        if j == len(punctuated):
            return punctuated
        for mark in punctuated[start:j]:
            if mark.isspace():
                continue
            # A mark sits against the word before it: `hello，你好`, not `hello ，`.
            if out and out[-1] == " " and mark in _FULL_WIDTH_MARKS:
                out.pop()
            out.append(mark)
        out.append(ch)
        j += 1
    out.extend(punctuated[j:])
    return "".join(out)


class ZhPunctuationRestorer:
    """One warm CT-Transformer. Load once at startup, call from any thread."""

    def __init__(self, models_dir: Path = MODELS_DIR) -> None:
        self._path = models_dir / MODEL_DIRNAME / MODEL_FILE
        self._punctuator = None
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._punctuator is not None

    def load(self) -> None:
        """Load the model, or stay unloaded when the seed did not fetch it.

        Optional like Dewpoint: a sidecar without it transcribes zh as before,
        and the API shows the plain transcript.
        """
        if not self._path.exists():
            return
        try:
            import sherpa_onnx

            self._punctuator = sherpa_onnx.OfflinePunctuation(
                sherpa_onnx.OfflinePunctuationConfig(
                    model=sherpa_onnx.OfflinePunctuationModelConfig(
                        ct_transformer=str(self._path), num_threads=RESTORE_THREADS
                    )
                )
            )
        except Exception:  # noqa: BLE001 — any failure here must not stop transcription
            log.exception("zh punctuation restorer failed to load; zh displays stay plain")
            self._punctuator = None

    def unload(self) -> None:
        self._punctuator = None

    def restore(
        self, text: str, context: str = "", terms: list[str] | None = None, pauses: list[int] | None = None
    ) -> str:
        """`text` with punctuation inserted."""
        p = self._punctuator
        if p is None:
            raise RuntimeError("zh punctuation restorer not loaded")
        if not text.strip():
            return text
        if not self._lock.acquire(timeout=LOCK_WAIT_S):
            raise RestorerBusyError("zh punctuation restorer busy")
        try:
            punctuated = p.add_punctuation(text)
        finally:
            self._lock.release()
        return _keep_spaces(text, punctuated)
