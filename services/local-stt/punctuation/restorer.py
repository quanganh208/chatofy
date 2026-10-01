"""Punctuation and truecasing for the Vietnamese DISPLAY transcript.

The Vietnamese recognizer emits bare uppercase syllables, which `zipformer_vi`
folds to lowercase with one capital. On screen that reads wrong in a way a reader
cannot undo: "mà chính ai trực tiếp gây ra" is "who exactly", not "AI itself",
and every name — "hoàng long", "openai" — loses its shape.

**A tagger, never a generator.** The LLM display repair was removed on
2026-08-29 for a median 25 s and a same-language injection surface, and both
came from the model being able to WRITE. Dewpoint labels each existing word with
the mark that follows it and its case; it cannot add, drop or reorder a word, so
nothing a speaker says can come back as words they did not say.

**Measured before chosen**, on 36 rows from 7 recorded sessions against Scribe:
punctuation F1 0 → 0.62, case F1 0.29 → 0.86, "AI" 0/26 → 26/26, against
vibert-capu at 0.50 / 0.78 / 24/26. Full dynamic int8 kept the speed and lost
"AI" (18–20/26 in three variants); quantizing only the 256k-row embedding is
what `download_models.py` ships, at fp32 accuracy and half the memory.

**Display only.** The raw transcript stays the canonical text for WER, the
translator and its context. Restored text into the translator was measured too,
and it does not fix what it was hoped to: the tagger splits "anh tuấn anh" the
same wrong way the translator does.
"""
from __future__ import annotations

import logging
import os
import threading
from pathlib import Path

from engines.base import MODELS_DIR

#: Where `scripts/download_models.py` puts the quantized member.
MODEL_DIRNAME = "dewpoint-mmbert-base"

#: Language the model is asked to read. The only direction with a caseless
#: recognizer; Parakeet's English is already cased and punctuated.
LANGUAGE = "vi"

#: How much of the previous piece is read as left context. A continuation needs
#: the clause it is inside, not the conversation; a window this size is one
#: forced piece and keeps the extra cost to a few milliseconds.
CONTEXT_WORDS = 40

#: Two, for the reason `speaker/embedder.py` gives: this runs beside a
#: recognizer that already holds the box's physical cores, and the restore runs
#: beside a ~700 ms translation, so it has the time and should not take the CPU.
RESTORE_THREADS = int(os.environ.get("LOCAL_STT_RESTORE_THREADS", "2"))

#: Mixed-case brand forms the model cannot produce: it predicts lower, Capital
#: or UPPER per word, and "OpenAI" is none of the three. Only words that are
#: never ordinary Vietnamese belong here — "AI" does NOT, because "ai" is also
#: the word for "who", and that choice is the model's to make from context.
#: Spoken Vietnamese number words. The tagger puts commas and full stops inside
#: a spoken number ("một trăm, hai mươi nghìn"), and the ITN downstream reads a
#: mark as the end of a number — measured turning 120.000 into "100, 20.000"
#: and a phone number into digits and words at random. Between two of these
#: words no mark and no capital is kept, which is exactly the run the ITN saw
#: before this restorer existed.
NUMBER_WORDS = frozenset(
    "không một mốt hai ba bốn tư năm lăm sáu bảy tám chín mười mươi trăm "
    "nghìn ngàn triệu tỷ tỉ lẻ linh phẩy rưỡi".split()
)

#: How long a request waits for the model before it is refused as busy. The
#: caller waits a few hundred milliseconds in all, so queueing behind another
#: restore would only hold a worker thread for an answer nobody will read —
#: refuse instead, as `/transcribe` does when its lanes are full.
LOCK_WAIT_S = 0.05

log = logging.getLogger(__name__)


class RestorerBusyError(Exception):
    """Another restore holds the model past `LOCK_WAIT_S`."""


BRAND_FORMS = {
    "openai": "OpenAI",
    "chatgpt": "ChatGPT",
    "vneid": "VNeID",
}


def mixed_case_terms(terms: list[str]) -> dict[str, str]:
    """The caller's hotwords that carry a case the model cannot predict.

    Only single words with a capital AFTER the first letter — "VNeID", "iPhone".
    A title-case term like "Long" is left to the model on purpose: "long" is
    also an ordinary Vietnamese word, and forcing it everywhere would be wrong
    more often than the model is.
    """
    out: dict[str, str] = {}
    for term in terms:
        term = term.strip()
        if not term or " " in term or not term.isalnum():
            continue
        if any(ch.isupper() for ch in term[1:]) and term.upper() != term:
            out[term.lower()] = term
    return out


class DisplayRestorer:
    """One warm Dewpoint member. Load once at startup, call from any thread."""

    def __init__(self, models_dir: Path = MODELS_DIR) -> None:
        self._path = models_dir / MODEL_DIRNAME
        self._punctuator = None
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._punctuator is not None

    def load(self) -> None:
        """Load the member, or stay unloaded when the seed has not run.

        Not fatal, unlike the recognizers: a sidecar without this still
        transcribes, and the API falls back to the numerals-only display. A
        missing model is a degraded display, not an outage.
        """
        if not (self._path / "onnx" / "mmbert-base" / "model.onnx").exists():
            return
        try:
            from punctuation.dewpoint import Punctuator

            self._punctuator = Punctuator(
                str(self._path),
                members=["mmbert-base"],
                backend="onnx",
                providers=["CPUExecutionProvider"],
                threads=RESTORE_THREADS,
            )
        except Exception:  # noqa: BLE001 — any failure here must not stop transcription
            log.exception("display restorer failed to load; the display stays plain")
            self._punctuator = None

    def unload(self) -> None:
        self._punctuator = None

    def restore(self, text: str, context: str = "", terms: list[str] | None = None) -> str:
        """Punctuated, truecased `text`, read after `context` when there is one.

        `context` is the piece this one continues. It is tagged together with
        `text` and its labels are thrown away, so the seam is decided with both
        sides in view: a continuation that is mid-sentence does not open with a
        capital, and one that really starts a sentence still does.
        """
        p = self._punctuator
        if p is None:
            raise RuntimeError("display restorer not loaded")
        from punctuation.dewpoint import _SENT_END, apply_case, split_words, surface_for

        words = split_words(text, LANGUAGE)
        if not words:
            return text
        lead = split_words(context, LANGUAGE)[-CONTEXT_WORDS:] if context else []
        if not self._lock.acquire(timeout=LOCK_WAIT_S):
            raise RestorerBusyError("display restorer busy")
        try:
            r = p.predict(lead + words, LANGUAGE)
        finally:
            self._lock.release()
        n = len(lead)
        punct = p._close(r["punct"][n:], r["punct_scores"][n:])
        case = list(r["case"][n:])
        # Inside a spoken number: no mark between its words, no capital on any
        # but its first. See NUMBER_WORDS.
        for i in range(len(words) - 1):
            if words[i] in NUMBER_WORDS and words[i + 1] in NUMBER_WORDS:
                punct[i] = "O"
                if case[i + 1] == "CAP":
                    case[i + 1] = "LOWER"

        forms = {**p.gazetteer.get(LANGUAGE, {}), **BRAND_FORMS, **mixed_case_terms(terms or [])}
        # A sentence starts here when there is no context, or when the context's
        # last word was tagged as ending one.
        starts = not lead or r["punct"][n - 1] in _SENT_END
        out = []
        for i, word in enumerate(words):
            if word in forms:
                out.append(forms[word])
                continue
            sentence_start = starts if i == 0 else punct[i - 1] in _SENT_END
            label = "CAP" if sentence_start and case[i] == "LOWER" else case[i]
            out.append(apply_case(word, label))
        surface = surface_for(LANGUAGE)
        return " ".join(w + surface.get(m, "") for w, m in zip(out, punct))
