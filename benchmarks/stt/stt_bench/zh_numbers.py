"""Arabic digits -> spoken Mandarin numerals, for CER scoring only.

The zh arms disagree on number form: SenseVoice with ITN writes `11点35分`,
Paraformer and SenseVoice without ITN write `十一点三十五分`, and FLEURS
references are written text (`1990 年`). Scoring them raw would charge a
correct recognition for a typesetting choice, so `normalize_text(language="zh")`
maps every side to the spoken form before CER.

Readings, chosen to match how a Mandarin speaker reads the written form:
- a 4-digit run followed by 年 is a year, read digit by digit (`1990年` -> 一九九零年);
- a run with a leading zero, or longer than 12 digits, is an identifier, read
  digit by digit;
- `a.b` is a decimal: cardinal integer part, 点, fraction digit by digit;
- `N%` is read 百分之N;
- any other run is a cardinal (`35` -> 三十五, `10` -> 十, `1300` -> 一千三百).

This is a scoring convention, not an ITN: ambiguous forms (`802.11` read as a
standard name, `10-60` read with 到) take the cardinal reading, and a
hypothesis that typesets the same number the same way gets the same reading,
so the convention costs the arms equally.
"""

import re

_DIGITS = "零一二三四五六七八九"
_SMALL_UNITS = ("", "十", "百", "千")
_BIG_UNITS = ("", "万", "亿")
_MAX_CARDINAL_DIGITS = 12

_PERCENT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*%")
_YEAR_RE = re.compile(r"(?<!\d)(\d{4})(?=\s*年)")
_DECIMAL_RE = re.compile(r"(?<!\d)(\d+)\.(\d+)(?!\d)")
_INT_RE = re.compile(r"\d+")


def digits_to_zh(digits: str) -> str:
    """Read a digit string one digit at a time: '1990' -> '一九九零'."""
    return "".join(_DIGITS[int(d)] for d in digits)


def _group_to_zh(n: int) -> str:
    """Read 0 < n < 10000 with internal zeros collapsed to one 零."""
    out = []
    zero_pending = False
    for pos in range(3, -1, -1):
        d = (n // 10**pos) % 10
        if d == 0:
            if out:
                zero_pending = True
            continue
        if zero_pending:
            out.append("零")
            zero_pending = False
        out.append(_DIGITS[d] + _SMALL_UNITS[pos])
    return "".join(out)


def int_to_zh(n: int) -> str:
    """Cardinal reading of 0 <= n < 10**12: 10 -> 十, 105 -> 一百零五, 10005 -> 一万零五."""
    if n < 0 or n >= 10**_MAX_CARDINAL_DIGITS:
        raise ValueError(f"cardinal out of range: {n}")
    if n == 0:
        return "零"
    groups = []
    while n:
        groups.append(n % 10000)
        n //= 10000
    out = []
    for idx in range(len(groups) - 1, -1, -1):
        group = groups[idx]
        if group == 0:
            continue
        # A gap to the next-higher non-empty group is read as one 零
        # (10005 -> 一万零五, 1000000005 -> 十亿零五).
        if out and (group < 1000 or groups[idx + 1] == 0):
            out.append("零")
        out.append(_group_to_zh(group) + _BIG_UNITS[idx])
    text = "".join(out)
    # 10-19 at the head of a number are read 十X, not 一十X.
    if text.startswith("一十"):
        text = text[1:]
    return text


def _cardinal_or_digits(run: str) -> str:
    if (len(run) > 1 and run.startswith("0")) or len(run) > _MAX_CARDINAL_DIGITS:
        return digits_to_zh(run)
    return int_to_zh(int(run))


def _decimal(match: re.Match) -> str:
    return f"{_cardinal_or_digits(match.group(1))}点{digits_to_zh(match.group(2))}"


def _percent(match: re.Match) -> str:
    value = match.group(1)
    if "." in value:
        whole, frac = value.split(".", 1)
        spoken = f"{_cardinal_or_digits(whole)}点{digits_to_zh(frac)}"
    else:
        spoken = _cardinal_or_digits(value)
    return f"百分之{spoken}"


def verbalize_zh(text: str) -> str:
    """Rewrite every ASCII digit run in `text` as spoken Mandarin numerals.

    Expects NFKC-normalized input (full-width digits already folded to ASCII).
    Digit-free text is returned unchanged.
    """
    if not any(ch.isascii() and ch.isdigit() for ch in text):
        return text
    text = _PERCENT_RE.sub(_percent, text)
    text = _YEAR_RE.sub(lambda m: digits_to_zh(m.group(1)), text)
    text = _DECIMAL_RE.sub(_decimal, text)
    return _INT_RE.sub(lambda m: _cardinal_or_digits(m.group(0)), text)
