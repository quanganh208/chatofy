"""Rules that undo two capitals the prod model writes and a reader does not.

Measured as arms (`arms/post_rule_arm.py`) on top of the prod model before any
of them ships, because each one trades against proper nouns:

- comma: a capital right after a comma, on a word whose next word is lowercase,
  is lowered — "Anh, Xin kính chào" → "Anh, xin kính chào". A capitalized next
  word keeps it, so "…, Hà Nội" survives; a one-syllable name after a comma
  ("…, Huế đẹp") is the case it gets wrong.
- title: a kinship or title word capitalized mid-sentence, directly before a
  capitalized name, is lowered — "chào Anh Tuấn" → "chào anh Tuấn". Not when
  the word before it is itself capitalized, so "Hoàng Anh Tuấn" survives.
- comma-common: the comma rule, only for a word Vietnamese writes in
  lowercase (`common_words`, counted from ViCapPunc train) — so "Xin" is
  lowered and "Berlin", "Arizona" are not.
- greet-comma: no comma between "chào" and a kinship word after it —
  "xin chào, anh Tuấn" → "xin chào anh Tuấn".
- title-comma: no comma after a kinship word that opens a sentence —
  "Anh, xin kính chào" → "Anh xin kính chào". The vocative "Anh, em xin lỗi"
  loses a correct comma; written Vietnamese has one here in 12 of 24,634 cases.

Words written in capitals throughout (AI, VTV) are never touched.
"""
import functools
import re

TITLES = frozenset("anh chị em ông bà cô chú bác cậu thầy dì".split())
_CORE = re.compile(r"[^\W_]+", re.UNICODE)
_TERMINAL = (".", "?", "!", "…")


@functools.cache
def _common() -> frozenset[str]:
    from punct_bench.common_words import load

    return load()


def _core(token: str) -> str:
    match = _CORE.search(token)
    return match.group() if match else ""


def _is_cap(core: str) -> bool:
    return bool(core) and core[0].isupper() and not (len(core) > 1 and core.isupper())


def _lower_first(token: str) -> str:
    for i, ch in enumerate(token):
        if ch.isalpha():
            return token[:i] + ch.lower() + token[i + 1 :]
    return token


def apply(text: str, rules: set[str]) -> str:
    common = _common() if "comma-common" in rules else frozenset()
    words = text.split(" ")
    cores = [_core(w) for w in words]
    out = list(words)
    for i in range(1, len(words)):
        prev, core = words[i - 1], cores[i]
        if not _is_cap(core) or prev.endswith(_TERMINAL):
            continue
        next_cap = i + 1 < len(words) and _is_cap(cores[i + 1])
        if "comma" in rules and prev.endswith(",") and i + 1 < len(words) and not next_cap:
            out[i] = _lower_first(words[i])
        elif (
            "comma-common" in rules and prev.endswith(",") and not next_cap and core.lower() in common
        ):
            out[i] = _lower_first(words[i])
        elif "title" in rules and core.lower() in TITLES and next_cap and not _is_cap(cores[i - 1]):
            out[i] = _lower_first(words[i])
    if "greet-comma" in rules or "title-comma" in rules:
        out = _drop_commas(out, rules)
    return " ".join(out)


def _drop_commas(words: list[str], rules: set[str]) -> list[str]:
    out = list(words)
    for i in range(len(out) - 1):
        core = _core(out[i]).lower()
        if not out[i].endswith(","):
            continue
        opens = i == 0 or out[i - 1].endswith(_TERMINAL)
        greet = "greet-comma" in rules and core == "chào" and _core(out[i + 1]).lower() in TITLES
        title = "title-comma" in rules and opens and core in TITLES and _core(out[i]) == out[i][:-1]
        if greet or title:
            out[i] = out[i][:-1]
    return out
