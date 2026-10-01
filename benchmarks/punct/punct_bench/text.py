"""The one tokenization every ruler, arm and score shares.

A word is a run of letters and digits; everything between two words is the gap
after the first, and the gap's punctuation is reduced to one class. Reducing is
what makes models with different mark sets comparable: Dewpoint writes `!`,
vibert-capu writes `:`, ViCapPunc labels only PERIOD, COMMA and QMARK.
"""
import re
import unicodedata

WORD = re.compile(r"[^\W_]+", re.UNICODE)

# Mark classes. Terminal marks other than `?` read as a full stop; clause marks
# read as a comma.
PERIOD, COMMA, QMARK = ".", ",", "?"
_CLASS = {".": PERIOD, "!": PERIOD, "…": PERIOD, ",": COMMA, ";": COMMA, ":": COMMA, "?": QMARK}


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def tokens(text: str) -> list[tuple[str, str]]:
    """Each word with the mark class in the gap after it ('' when none).

    `?` wins over `.` and `.` over `,` when a gap holds several, because the
    stronger boundary is the one a reader sees.
    """
    text = nfc(text)
    out: list[tuple[str, str]] = []
    matches = list(WORD.finditer(text))
    for i, m in enumerate(matches):
        gap_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        classes = {_CLASS[c] for c in text[m.end() : gap_end] if c in _CLASS}
        mark = QMARK if QMARK in classes else PERIOD if PERIOD in classes else COMMA if COMMA in classes else ""
        out.append((m.group(), mark))
    return out


def model_input(text: str) -> str:
    """What every arm is given: lowercase words, single spaces, no marks."""
    return " ".join(w.lower() for w, _ in tokens(text))
