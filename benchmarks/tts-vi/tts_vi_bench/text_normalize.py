"""Shared text normalization applied to references AND hypotheses before WER.

VERBATIM COPY of `benchmarks/stt/stt_bench/text_normalize.py`. Do not edit it
here. The human-speech control floors this harness quotes — PhoWhisper-vi 7.71%
and Zipformer-vi 5.38% over the same 50 VIVOS utterances — were produced by that
file. Diverging from it silently invalidates the comparison those floors exist to
enable, which is the one coupling the "benchmark projects stay independent"
convention does not cover. If the STT harness's copy changes, re-copy it and
re-derive the floors.

Every engine's output goes through the exact same pipeline so WER differences
reflect the models, not formatting conventions. Vietnamese diacritics are
preserved (only casing/punctuation/whitespace are normalized); numbers are left
as written — a known WER caveat recorded in the results report.
"""

import re
import unicodedata

# \w with re.UNICODE keeps Vietnamese letters and digits; everything else
# (punctuation, symbols) becomes a space so word boundaries survive.
_NON_WORD_RE = re.compile(r"[^\w\s]", re.UNICODE)
_UNDERSCORE_RE = re.compile(r"_")
_WHITESPACE_RE = re.compile(r"\s+")


def normalize_text(text: str) -> str:
    """Normalize a transcript for WER comparison.

    Steps: Unicode NFC (composes Vietnamese diacritics consistently across
    engines), lowercase, strip punctuation/symbols, collapse whitespace.
    """
    text = unicodedata.normalize("NFC", text)
    text = text.lower()
    text = _NON_WORD_RE.sub(" ", text)
    # \w matches underscore; treat it as punctuation, not a word character.
    text = _UNDERSCORE_RE.sub(" ", text)
    text = _WHITESPACE_RE.sub(" ", text)
    return text.strip()
