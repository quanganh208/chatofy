"""Arm 4's features: what each recognizer's own answer says about the language.

Recognizer competition decodes a turn on every candidate engine and asks which
one "believed" its transcript. The evidence per engine:

- **Token confidence**: mean and min of `ys_log_probs`. A recognizer fed
  another language still emits tokens, but less confidently.
- **Token rate**: tokens per second of audio. Mismatched audio tends to come
  out either starved (the decoder emits little) or shredded into many short
  pieces. (The plan also names a blank ratio; sherpa-onnx's offline result
  exposes no frame-level blanks, and for a transducer the blank count is frames
  minus tokens, i.e. the same information as this rate, so it is not repeated.)
- **Script evidence** in the text the engine produced: the share of letters
  carrying Vietnamese diacritics (vi engine), the share of words found in an
  English lexicon (en engine), the share of characters that are Han (zh).

A turn the engine answered with nothing gets an `empty` flag and zeros, since
"this recognizer heard no words" is itself evidence.
"""

from __future__ import annotations

import math
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

import numpy as np

from lid_bench.sidecar import Decode

ENGINE_ORDER = ("vi", "en", "zh")
PER_ENGINE = ("empty", "mean_logp", "min_logp", "tokens_per_s", "script")
#: A fused arm also carries a LID model's log-probability for each engine's
#: language; rows without it are plain recognizer competition.
LID_FEATURE = "lid_logp"

LEXICON_PATH = Path("/usr/share/dict/american-english")
_HAN = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
_WORD = re.compile(r"[a-z']+")
#: Base letters plus the Vietnamese-only ones; a letter "has a diacritic" when it
#: is outside plain ASCII a-z after lowercasing.
_VI_EXTRA = set("ăâđêôơư")


@lru_cache(maxsize=1)
def english_lexicon() -> frozenset[str]:
    if not LEXICON_PATH.exists():
        raise FileNotFoundError(
            f"{LEXICON_PATH} missing: install the `wamerican` package, or the en "
            "script feature cannot be computed"
        )
    words = LEXICON_PATH.read_text(encoding="utf-8", errors="ignore").split()
    return frozenset(w.lower().removesuffix("'s") for w in words)


def vi_diacritic_ratio(text: str) -> float:
    letters = [c for c in text.lower() if c.isalpha()]
    if not letters:
        return 0.0
    marked = sum(1 for c in letters if c in _VI_EXTRA or unicodedata.decomposition(c) != "")
    return marked / len(letters)


def en_lexicon_ratio(text: str) -> float:
    words = _WORD.findall(text.lower())
    if not words:
        return 0.0
    lexicon = english_lexicon()
    return sum(1 for w in words if w.removesuffix("'s") in lexicon) / len(words)


def han_ratio(text: str) -> float:
    chars = [c for c in text if not c.isspace()]
    if not chars:
        return 0.0
    return sum(1 for c in chars if _HAN.match(c)) / len(chars)


SCRIPT = {"vi": vi_diacritic_ratio, "en": en_lexicon_ratio, "zh": han_ratio}


def engine_features(decode: Decode, duration_s: float) -> dict[str, float]:
    """The PER_ENGINE values for one engine's answer to one turn."""
    if not decode.text.strip() or not decode.tokens:
        return {"empty": 1.0, "mean_logp": 0.0, "min_logp": 0.0, "tokens_per_s": 0.0, "script": 0.0}
    logp = decode.log_probs
    return {
        "empty": 0.0,
        "mean_logp": float(np.mean(logp)) if logp else 0.0,
        "min_logp": float(np.min(logp)) if logp else 0.0,
        "tokens_per_s": len(decode.tokens) / max(duration_s, 1e-3),
        "script": SCRIPT[decode.lang](decode.text),
    }


def has_lid(per_engine: dict[str, dict[str, float]]) -> bool:
    return all(LID_FEATURE in values for values in per_engine.values())


def _compared(lid: bool) -> tuple[str, ...]:
    return ("mean_logp", LID_FEATURE) if lid else ("mean_logp",)


def feature_names(candidates: tuple[str, ...], lid: bool = False) -> list[str]:
    per = PER_ENGINE + ((LID_FEATURE,) if lid else ())
    names = [f"{lang}.{name}" for lang in ENGINE_ORDER if lang in candidates for name in per]
    ordered = [lang for lang in ENGINE_ORDER if lang in candidates]
    names += [f"d.{name}.{a}-{b}" for name in _compared(lid) for i, a in enumerate(ordered) for b in ordered[i + 1:]]
    return names


def vector(per_engine: dict[str, dict[str, float]], candidates: tuple[str, ...]) -> list[float]:
    """Features for one turn restricted to `candidates`, in `feature_names` order.

    Pairwise confidence differences are added explicitly: a linear model can
    form them, but they are the single most direct comparison and making them
    a feature keeps the regularised fit from having to discover them.
    """
    lid = has_lid(per_engine)
    per = PER_ENGINE + ((LID_FEATURE,) if lid else ())
    ordered = [lang for lang in ENGINE_ORDER if lang in candidates]
    values = [per_engine[lang][name] for lang in ordered for name in per]
    values += [
        per_engine[a][name] - per_engine[b][name]
        for name in _compared(lid) for i, a in enumerate(ordered) for b in ordered[i + 1:]
    ]
    return [0.0 if math.isnan(v) else v for v in values]
