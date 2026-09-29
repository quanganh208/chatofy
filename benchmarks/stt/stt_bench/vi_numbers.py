"""Vietnamese spoken-form number normalization, opt-in for the `vi` WER path.

`normalize_text` leaves digits as written; a Scribe/reference writer and a
recognizer both spell numbers as words ("hai mươi lăm"), but any arm that
emits digits ("25") is charged a full mismatch for every one, worth about 1.2
points on the 1cd04a39 recording alone. `verbalize_vi` reads digit runs into
canonical spoken Vietnamese so both sides compare as words; the canonical
form it produces, and any digit-free ASR text, then goes through
`canonicalize_vi_number_words` to collapse the handful of spoken variants
that mean the same digit (`lẻ`/`linh`, and the "mươi"-context readings of 1,
4, 5) onto one form, so a recognizer using the non-standard reading isn't
charged either.

Known caveat: not every spoken variant is covered (for example a "mươi"
dropped entirely, "hai lăm" for "hai mươi lăm"). A residual mismatch like
that shows up as WER, never as a false match, so it is a safe gap.
"""

import re

_ONES = {
    0: "không",
    1: "một",
    2: "hai",
    3: "ba",
    4: "bốn",
    5: "năm",
    6: "sáu",
    7: "bảy",
    8: "tám",
    9: "chín",
}

# Group names by 10^(3*index): units, thousand, million, billion, thousand-billion.
_GROUP_NAMES = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ"]

# A number token: a leading digit, optional interior digits/./,, a trailing
# digit, and an optional trailing "%". Handles plain runs ("302"), thousands
# grouping ("2.500"), decimals ("2,5") and percentages ("50%") in one match.
_NUMBER_TOKEN_RE = re.compile(r"\d(?:[\d.,]*\d)?%?")


def _digit_word(digit: int, tens_context: bool) -> str:
    """Spoken word for a single digit 0-9.

    tens_context: this digit is the last digit of an "X mươi" reading (20-99),
    where 1, 4 and 5 take the irregular forms "mốt", "tư", "lăm" instead of
    the plain digit word. After "mười" (10-19) only 5 is irregular ("mười
    lăm"): 11 is "mười một", never "mười mốt", and 14 is "mười bốn".
    """
    if tens_context:
        if digit == 1:
            return "mốt"
        if digit == 4:
            return "tư"
        if digit == 5:
            return "lăm"
    return _ONES[digit]


def _read_three_digit_group(n: int, force_hundreds: bool) -> list[str]:
    """Read a 0-999 group into words.

    force_hundreds: a higher group (thousand, million, ...) was non-zero, so
    a zero hundreds digit must still be voiced ("không trăm") instead of
    silently dropped.
    """
    hundreds, tens, units = n // 100, (n // 10) % 10, n % 10
    words: list[str] = []
    if hundreds > 0:
        words += [_ONES[hundreds], "trăm"]
    elif force_hundreds:
        words += ["không", "trăm"]

    if tens == 0:
        if units > 0 and (hundreds > 0 or force_hundreds):
            words.append("linh")
        if units > 0:
            words.append(_digit_word(units, tens_context=False))
    elif tens == 1:
        words.append("mười")
        if units > 0:
            words.append("lăm" if units == 5 else _ONES[units])
    else:
        words += [_ONES[tens], "mươi"]
        if units > 0:
            words.append(_digit_word(units, tens_context=True))
    return words


def _read_number(n: int) -> str:
    if n == 0:
        return "không"
    groups: list[int] = []
    remaining = n
    while remaining > 0:
        groups.append(remaining % 1000)
        remaining //= 1000

    parts: list[str] = []
    started = False
    for i in range(len(groups) - 1, -1, -1):
        group = groups[i]
        # A zero group is silent whether it leads or not: 1000 is "một nghìn",
        # not "một nghìn không trăm".
        if group == 0:
            continue
        words = _read_three_digit_group(group, force_hundreds=started)
        name = _GROUP_NAMES[i] if i < len(_GROUP_NAMES) else ""
        parts.append(" ".join(words + ([name] if name else [])))
        started = True
    return " ".join(parts)


def _read_fraction(digits: str) -> str:
    """Digits after "phẩy", keeping leading zeros: 2,05 is "hai phẩy không năm",
    never the same words as 2,5."""
    stripped = digits.lstrip("0")
    words = ["không"] * (len(digits) - len(stripped))
    if stripped:
        words.append(_read_number(int(stripped)))
    return " ".join(words)


def _verbalize_token(token: str) -> str:
    percent = token.endswith("%")
    if percent:
        token = token[:-1]
    # More than one comma, or a "." after the comma, is not one decimal number
    # ("1,2,3" is a list): read each digit run as its own number rather than
    # letting int() raise and abort a whole scoring run.
    if token.count(",") > 1 or "." in token.partition(",")[2]:
        words = " ".join(_read_number(int(run)) for run in re.findall(r"\d+", token))
        return words + (" phần trăm" if percent else "")
    if "," in token:
        integer_part, _, decimal_part = token.partition(",")
    else:
        integer_part, decimal_part = token, ""
    integer_part = integer_part.replace(".", "")

    words = _read_number(int(integer_part)) if integer_part else ""
    if decimal_part:
        words += " phẩy " + _read_fraction(decimal_part)
    if percent:
        words += " phần trăm"
    return words


def verbalize_vi(text: str) -> str:
    """Replace digit runs (0-10^12) in `text` with canonical spoken Vietnamese.

    A "." between 3-digit groups is a thousands separator, a "," between
    digits is the decimal separator "phẩy", and a trailing "%" becomes
    "phần trăm".
    """
    return _NUMBER_TOKEN_RE.sub(lambda m: _verbalize_token(m.group(0)), text)


_CANON_TARGET = {"mốt": "một", "tư": "bốn", "lăm": "năm", "nhăm": "năm"}
_WORD_RE = re.compile(r"\w+", re.UNICODE)


def canonicalize_vi_number_words(text: str) -> str:
    """Collapse spoken-number variants onto one canonical form.

    `lẻ` (the Southern zero-tens filler) becomes `linh` (Northern)
    everywhere. After `mươi`, the irregular tens-context digit words `mốt`,
    `tư`, `lăm`/`nhăm` collapse to the plain digit words `một`, `bốn`,
    `năm`. After `mười`, `lăm` (fifteen) and the colloquial `tư` (fourteen)
    collapse the same way.
    """
    tokens = text.split(" ")
    bare = [_WORD_RE.search(t) for t in tokens]
    bare_lower = [m.group(0).lower() if m else "" for m in bare]

    out = list(tokens)
    for i, word in enumerate(bare_lower):
        prev = bare_lower[i - 1] if i > 0 else None
        if word == "lẻ":
            out[i] = "linh"
        elif prev == "mươi" and word in ("mốt", "tư", "lăm", "nhăm"):
            out[i] = _CANON_TARGET[word]
        elif prev == "mười" and word in ("lăm", "tư"):
            out[i] = _CANON_TARGET[word]
    return " ".join(out)
