"""Shared text normalization applied to references AND hypotheses before WER.

Every engine's output goes through the exact same pipeline so WER differences
reflect the models, not formatting conventions. Vietnamese diacritics are
preserved (only casing/punctuation/whitespace are normalized); numbers are
left as written by default — opt in with `language="vi"` to apply spoken-form
number normalization instead (see `vi_numbers`).

`language="zh"` is a separate pipeline for Mandarin, scored by CER only: NFKC
(folds full-width digits, letters and spaces), Arabic digits read as spoken
Mandarin numerals (see `zh_numbers`), lowercase, then ALL punctuation, symbols
and whitespace removed — Chinese is written without spaces, so engines that
space-separate characters or tokens must not pay for it. Traditional -> Simplified
conversion is NOT applied.
"""

import re
import unicodedata

from .vi_numbers import canonicalize_vi_number_words, verbalize_vi
from .zh_numbers import verbalize_zh

# \w with re.UNICODE keeps Vietnamese letters and digits; everything else
# (punctuation, symbols) becomes a space so word boundaries survive.
_NON_WORD_RE = re.compile(r"[^\w\s]", re.UNICODE)
_UNDERSCORE_RE = re.compile(r"_")
_WHITESPACE_RE = re.compile(r"\s+")


def _normalize_zh(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = verbalize_zh(text)
    text = text.lower()
    text = _NON_WORD_RE.sub("", text)
    text = _UNDERSCORE_RE.sub("", text)
    return _WHITESPACE_RE.sub("", text)


def normalize_text(text: str, language: str | None = None) -> str:
    """Normalize a transcript for WER comparison.

    Steps: for `language="vi"`, verbalize digit runs into spoken Vietnamese
    and canonicalize spoken-number variants first (both no-ops on digit-free,
    already-canonical text); then Unicode NFC (composes Vietnamese diacritics
    consistently across engines), lowercase, strip punctuation/symbols,
    collapse whitespace. `language=None` (the default) skips the vi step, so
    it never affects an already-recorded WER. `language="zh"` takes its own
    path (`_normalize_zh`) and returns a string with no whitespace at all.
    """
    if language == "zh":
        return _normalize_zh(text)
    if language == "vi":
        text = canonicalize_vi_number_words(verbalize_vi(text))
    text = unicodedata.normalize("NFC", text)
    text = text.lower()
    text = _NON_WORD_RE.sub(" ", text)
    # \w matches underscore; treat it as punctuation, not a word character.
    text = _UNDERSCORE_RE.sub(" ", text)
    text = _WHITESPACE_RE.sub(" ", text)
    return text.strip()
