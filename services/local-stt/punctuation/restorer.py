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

#: Number words that are just as often ordinary words: "không" is "not" and the
#: question particle, "một" is "a", "ba" is "father", "năm" is "year", "tư" is
#: "private", "mốt" is "fashion". A run made only of these is not evidence of a
#: spoken number — "có khỏe không? Một tuần nữa" is two sentences — so the guard
#: needs at least one word outside this set before it clears anything.
AMBIGUOUS_NUMBER_WORDS = frozenset("không một mốt ba năm tư lẻ linh".split())

#: Marks the guard never clears. A question or an exclamation inside a spoken
#: number is not something the tagger was measured producing; at a real boundary
#: ("có không? Hai tuần nữa") it is the sentence, and the ITN does not need it gone.
KEPT_MARKS = frozenset({"QUESTION", "EXCLAM"})

#: How long a request waits for the model before it is refused as busy. Sized
#: against the API caller, which stops waiting 300 ms after the restore started
#: (`RESTORE_BUDGET_MS`; see `http-util.ts` in ai-providers): one inference is
#: ~110 ms at p95, so a wait of 150 ms still lets a request queued behind ONE
#: other restore (the two pieces of a split turn, a final behind a speculation)
#: finish inside the budget. Anything longer only holds a worker thread for an
#: answer nobody will read — refuse instead, as `/transcribe` does when its lanes
#: are full. 50 ms was shorter than one inference, so concurrent restores
#: refused each other.
LOCK_WAIT_S = 0.15

log = logging.getLogger(__name__)


class RestorerBusyError(Exception):
    """Another restore holds the model past `LOCK_WAIT_S`."""



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


def _join_spoken_numbers(words: list[str], punct: list[str], case: list[str]) -> None:
    """Inside a spoken number: no mark between its words, no capital on any but
    its first. Edits `punct` and `case` in place. See NUMBER_WORDS.

    A run is a maximal stretch of number words; it is treated as a number only
    when it holds a word outside AMBIGUOUS_NUMBER_WORDS, and even then a
    question or exclamation mark inside it is kept as the boundary it is.
    """
    i = 0
    while i < len(words):
        if words[i] not in NUMBER_WORDS:
            i += 1
            continue
        end = i
        while end + 1 < len(words) and words[end + 1] in NUMBER_WORDS:
            end += 1
        run = words[i : end + 1]
        if any(w not in AMBIGUOUS_NUMBER_WORDS for w in run):
            for j in range(i, end):
                if punct[j] in KEPT_MARKS:
                    continue
                punct[j] = "O"
                if case[j + 1] == "CAP":
                    case[j + 1] = "LOWER"
        i = end + 1


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
        _join_spoken_numbers(words, punct, case)

        forms = {**p.gazetteer.get(LANGUAGE, {}), **mixed_case_terms(terms or [])}
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
