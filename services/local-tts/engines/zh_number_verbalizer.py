"""Digits in Chinese text -> spoken Mandarin words, for the zh voice only.

Kokoro reads a digit it is handed with its English front end, so `15%` came out
as "fifteen percent" inside a Chinese sentence — the worst line of the zh
benchmark. sherpa-onnx ships rule FSTs for this, and none of them can be used
here: they are set on the whole `OfflineTtsConfig`, so they rewrite the digits
in ENGLISH text too, and the en instance is the same instance. Measured on the
en digit set (benchmarks/tts/data/sentences-en-digits.txt): `number-zh.fst`
turns "room 402" into "room 四百零二", `date-zh.fst` turns "born in 1998" into
"born in 一九九八" (spoken as "Ichochopa"), and `phone-zh.fst` rewrites a long
card number. So every digit shape is verbalized here, in Python, and only for
text the zh engine speaks.

The readings are the ones `benchmarks/stt/stt_bench/zh_numbers.py` already
scores with, plus the shapes speech needs and scoring did not: clock times,
ISO dates, phone-length runs (digit by digit, `1` read 幺) and version strings.
"""
import re

_DIGITS = "零一二三四五六七八九"
_SMALL_UNITS = ("", "十", "百", "千")
_BIG_UNITS = ("", "万", "亿")
_MAX_CARDINAL_DIGITS = 12
#: A run this long is a phone number or an identifier, read digit by digit.
_DIGITWISE_FROM = 11

#: Full-width forms a zh translation may contain, folded to ASCII first. The
#: full-width colon is NOT folded here — it is ordinary punctuation in Chinese
#: (`注意：`); `_TIME` accepts it between two digit groups instead.
_FULL_WIDTH = str.maketrans("０１２３４５６７８９％．", "0123456789%.")

#: 2 before a measure word is 两, not 二: 两个人, 两点, 两天.
_LIANG_BEFORE = "个位种次件本张天年点只条台辆份家岁小周倍千万亿"

_THOUSANDS = re.compile(r"(?<=\d),(?=\d{3}(?!\d))")
_ISO_DATE = re.compile(r"(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)")
_PERCENT = re.compile(r"(\d+(?:\.\d+)?)\s*%")
_TIME = re.compile(r"(?<![\d.])(\d{1,2})[:：](\d{2})(?![\d:：])")
_YEAR = re.compile(r"(?<!\d)(\d{4})(?=\s*年)")
_VERSION = re.compile(r"(?<![\d.])\d+(?:\.\d+){2,}(?![\d.])")
_DECIMAL = re.compile(r"(?<![\d.])(\d+)\.(\d+)(?![\d.])")
_INTEGER = re.compile(r"\d+")


def digits_to_zh(digits: str, phone: bool = False) -> str:
    """One digit at a time: '1990' -> '一九九零'; with `phone`, 1 is read 幺."""
    spoken = "".join(_DIGITS[int(d)] for d in digits)
    return spoken.replace("一", "幺") if phone else spoken


def _group_to_zh(n: int) -> str:
    """0 < n < 10000, internal zeros collapsed to one 零."""
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
    """Cardinal reading: 10 -> 十, 105 -> 一百零五, 2000 -> 两千, 10005 -> 一万零五."""
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
        if out and (group < 1000 or groups[idx + 1] == 0):
            out.append("零")
        out.append(_group_to_zh(group) + _BIG_UNITS[idx])
    text = "".join(out)
    if text.startswith("一十"):
        text = text[1:]
    # A leading 2 before 千/万/亿 is said 两 (两千, 两万).
    return re.sub(r"^二(?=[千万亿])", "两", text)


def _number(run: str) -> str:
    if (len(run) > 1 and run.startswith("0")) or len(run) > _MAX_CARDINAL_DIGITS:
        return digits_to_zh(run)
    if len(run) >= _DIGITWISE_FROM:
        return digits_to_zh(run, phone=True)
    return int_to_zh(int(run))


def _decimal(whole: str, fraction: str) -> str:
    return f"{_number(whole)}点{digits_to_zh(fraction)}"


def _time(match: re.Match) -> str:
    hour, minute = int(match.group(1)), int(match.group(2))
    if hour > 24 or minute > 59:
        return match.group(0)
    spoken = f"{'两' if hour == 2 else int_to_zh(hour)}点"
    if minute == 0:
        return spoken
    return spoken + (f"零{_DIGITS[minute]}" if minute < 10 else int_to_zh(minute))


def _integer(match: re.Match, text: str) -> str:
    run = match.group(0)
    following = text[match.end() : match.end() + 1]
    if run == "2" and following and following in _LIANG_BEFORE:
        return "两"
    return _number(run)


def verbalize_zh(text: str) -> str:
    """Rewrite every digit in `text` as spoken Mandarin. Digit-free text is unchanged."""
    if not any(ch.isdigit() for ch in text):
        return text
    text = _THOUSANDS.sub("", text.translate(_FULL_WIDTH))
    text = _ISO_DATE.sub(
        lambda m: f"{digits_to_zh(m.group(1))}年{int_to_zh(int(m.group(2)))}月{int_to_zh(int(m.group(3)))}日",
        text,
    )
    text = _PERCENT.sub(
        lambda m: "百分之" + (_decimal(*m.group(1).split(".", 1)) if "." in m.group(1) else _number(m.group(1))),
        text,
    )
    text = _TIME.sub(_time, text)
    text = _YEAR.sub(lambda m: digits_to_zh(m.group(1)), text)
    text = _VERSION.sub(lambda m: "点".join(_number(part) for part in m.group(0).split(".")), text)
    text = _DECIMAL.sub(lambda m: _decimal(m.group(1), m.group(2)), text)
    return _INTEGER.sub(lambda m: _integer(m, text), text)
