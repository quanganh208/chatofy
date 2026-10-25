"""Round-trip error rates: zh mixed error rate (CER) and en WER.

zh normalization, applied identically to reference and hypothesis:

1. NFKC (full-width letters/digits/punctuation become half-width).
2. Lower-case.
3. Numbers to ONE form — Chinese numerals. Arabic numbers are spelled out:
   a 4-digit number followed by 年 and any run of 7+ digits (a phone number)
   digit by digit, everything else as a cardinal (`128` -> 一百二十八,
   `4.8` -> 四点八), and `N%` as 百分之N. Then 两 -> 二 and 幺 -> 一 and
   〇 -> 零, so the colloquial and the formal reading of the same digit count as
   the same character. Chinese numerals are never converted to Arabic: that
   direction needs inverse text normalization, which is where judges disagree.
4. Strip all whitespace and all punctuation/symbols (Unicode P* and S*).

Tokens are then each CJK character on its own plus each Latin/digit run as one
token, so an embedded English word ("iphone") is one unit instead of six
letters. That is the usual mixed error rate for zh-en code-switching; on a
sentence with no Latin text it is plain CER.

Duplicated on purpose from nothing shared: benchmarks/stt writes its own zh
normalizer concurrently, and the benchmark projects stay independent (see
measure.py). The rule above is the one plan.md fixes for the STT bench too.
"""

import re
import unicodedata

_DIGITS = "零一二三四五六七八九"
_SMALL_UNITS = ("", "十", "百", "千")


def _cardinal_below_10000(n: int) -> str:
    out, zero_pending = "", False
    for power in (3, 2, 1, 0):
        d = (n // 10**power) % 10
        if d == 0:
            if out:
                zero_pending = True
            continue
        if zero_pending:
            out += "零"
            zero_pending = False
        out += _DIGITS[d] + _SMALL_UNITS[power]
    return out


def cardinal_zh(n: int) -> str:
    """Integer -> Chinese cardinal reading, up to 10^12 - 1."""
    if n < 0 or n >= 10**12:
        raise ValueError(f"out of range: {n}")
    if n == 0:
        return "零"
    parts = []
    for unit, value in (("亿", n // 10**8), ("万", (n // 10**4) % 10**4), ("", n % 10**4)):
        if value == 0:
            if parts:
                parts.append("零")
            continue
        if parts and value < 1000 and parts[-1] != "零":
            parts.append("零")
        parts.append(_cardinal_below_10000(value) + unit)
    text = "".join(parts).rstrip("零")
    text = re.sub("零+", "零", text)
    # 10-19 are read 十X, not 一十X, when they lead the number.
    if text.startswith("一十"):
        text = text[1:]
    return text


def _digitwise(s: str) -> str:
    return "".join(_DIGITS[int(c)] for c in s)


def _number_to_zh(match: re.Match) -> str:
    integer, fraction, percent, year = match.group(1), match.group(2), match.group(3), match.group(4)
    if year and len(integer) == 4 and not fraction:
        spoken = _digitwise(integer)
    elif len(integer) >= 7 and not fraction:
        spoken = _digitwise(integer)
    else:
        spoken = cardinal_zh(int(integer))
        if fraction:
            spoken += "点" + _digitwise(fraction)
    if percent:
        spoken = "百分之" + spoken
    return spoken + (year or "")


_NUMBER = re.compile(r"(\d+)(?:\.(\d+))?(%)?(年)?")
_DROP = re.compile(r"\s+")


def _strip_punct(text: str) -> str:
    return "".join(c for c in text if not unicodedata.category(c).startswith(("P", "S")))


def normalize_zh(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    text = _NUMBER.sub(_number_to_zh, text)
    text = text.replace("两", "二").replace("幺", "一").replace("〇", "零")
    return _strip_punct(_DROP.sub("", text))


_TOKEN = re.compile(r"[a-z0-9]+|\S")


def tokenize_zh(text: str) -> list[str]:
    return _TOKEN.findall(normalize_zh(text))


def normalize_en(text: str) -> list[str]:
    text = unicodedata.normalize("NFKC", text).lower().replace("’", "'")
    text = re.sub(r"[^\w\s']", " ", text)
    return [w.strip("'") for w in text.split() if w.strip("'")]


def edit_distance(ref: list[str], hyp: list[str]) -> int:
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i] + [0] * len(hyp)
        for j, h in enumerate(hyp, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h))
        prev = cur
    return prev[-1]


def corpus_error_rate(refs: list[list[str]], hyps: list[list[str]]) -> float:
    """Sum of edits over sum of reference tokens, in percent."""
    if len(refs) != len(hyps):
        raise ValueError(f"{len(refs)} references vs {len(hyps)} hypotheses")
    total = sum(len(r) for r in refs)
    if total == 0:
        raise ValueError("empty references")
    return 100.0 * sum(edit_distance(r, h) for r, h in zip(refs, hyps)) / total


def sentence_error_rate(ref: list[str], hyp: list[str]) -> float:
    return 100.0 * edit_distance(ref, hyp) / max(len(ref), 1)
