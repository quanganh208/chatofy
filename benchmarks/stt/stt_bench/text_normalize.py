"""Shared text normalization applied to references AND hypotheses before WER.

Every engine's output goes through the exact same pipeline so WER differences
reflect the models, not formatting conventions. Vietnamese diacritics are
preserved (only casing/punctuation/whitespace are normalized); numbers are
left as written by default — opt in with `language="vi"` to apply spoken-form
number normalization instead (see `vi_numbers`).
"""

import re
import unicodedata

from .vi_numbers import canonicalize_vi_number_words, verbalize_vi

# \w with re.UNICODE keeps Vietnamese letters and digits; everything else
# (punctuation, symbols) becomes a space so word boundaries survive.
_NON_WORD_RE = re.compile(r"[^\w\s]", re.UNICODE)
_UNDERSCORE_RE = re.compile(r"_")
_WHITESPACE_RE = re.compile(r"\s+")


def normalize_text(text: str, language: str | None = None) -> str:
    """Normalize a transcript for WER comparison.

    Steps: for `language="vi"`, verbalize digit runs into spoken Vietnamese
    and canonicalize spoken-number variants first (both no-ops on digit-free,
    already-canonical text); then Unicode NFC (composes Vietnamese diacritics
    consistently across engines), lowercase, strip punctuation/symbols,
    collapse whitespace. `language=None` (the default) skips the vi step, so
    it never affects an already-recorded WER.
    """
    if language == "vi":
        text = canonicalize_vi_number_words(verbalize_vi(text))
    text = unicodedata.normalize("NFC", text)
    text = text.lower()
    text = _NON_WORD_RE.sub(" ", text)
    # \w matches underscore; treat it as punctuation, not a word character.
    text = _UNDERSCORE_RE.sub(" ", text)
    text = _WHITESPACE_RE.sub(" ", text)
    return text.strip()
