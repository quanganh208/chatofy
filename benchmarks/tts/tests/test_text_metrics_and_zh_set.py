import re
from pathlib import Path

import pytest

from tts_bench.engines import create_engine
from tts_bench.measure import load_sentences
from tts_bench.text_metrics import (
    cardinal_zh,
    corpus_error_rate,
    edit_distance,
    normalize_en,
    normalize_zh,
    tokenize_zh,
)

BENCH_ROOT = Path(__file__).resolve().parent.parent
ZH_SET = BENCH_ROOT / "data" / "zh-sentences-conversational.txt"


@pytest.mark.parametrize(
    ("n", "spoken"),
    [(0, "零"), (5, "五"), (10, "十"), (12, "十二"), (20, "二十"), (40, "四十"), (110, "一百一十"),
     (128, "一百二十八"), (305, "三百零五"), (2000, "二千"), (6999, "六千九百九十九"),
     (10005, "一万零五"), (120000, "十二万"), (100000000, "一亿")],
)
def test_cardinal_zh(n, spoken):
    assert cardinal_zh(n) == spoken


def test_normalize_zh_number_forms():
    assert normalize_zh("2026年10月20日") == "二零二六年十月二十日"
    assert normalize_zh("评分是4.8分") == "评分是四点八分"
    assert normalize_zh("增长了15%。") == "增长了百分之十五"
    assert normalize_zh("13812345678") == "一三八一二三四五六七八"
    # 两/二 and 幺/一 are the same digit read two ways.
    assert normalize_zh("两千") == normalize_zh("2000") == "二千"
    assert normalize_zh("幺三八") == "一三八"


def test_normalize_zh_strips_space_punct_and_width():
    assert normalize_zh("你好， 今天！ ＡＩ？") == "你好今天ai"


def test_tokenize_zh_keeps_latin_words_whole():
    assert tokenize_zh("新的iPhone，很好") == ["新", "的", "iphone", "很", "好"]


def test_error_rates():
    assert edit_distance(list("abc"), list("abd")) == 1
    assert edit_distance([], list("ab")) == 2
    assert corpus_error_rate([list("你好"), list("谢谢你")], [list("你好"), list("谢你")]) == pytest.approx(20.0)
    with pytest.raises(ValueError):
        corpus_error_rate([list("a")], [])
    assert normalize_en("It's 3 o'clock, OK?") == ["it's", "3", "o'clock", "ok"]


def test_zh_sentence_set_is_the_reference():
    sentences = load_sentences(ZH_SET)
    assert len(sentences) == 30
    texts = [t for _, t in sentences]
    assert all(re.search(r"[一-鿿]", t) for t in texts)
    joined = "".join(texts)
    for brand in ("iPhone", "AI", "Zoom", "ChatGPT"):
        assert brand in joined
    assert sum(bool(re.search(r"\d", t)) for t in texts) >= 10
    # Every reference normalizes to CJK characters and Latin words only.
    assert all(re.fullmatch(r"[一-鿿a-z]+", normalize_zh(t)) for t in texts)


def test_create_engine_requires_sid_only_for_multi_speaker():
    with pytest.raises(ValueError):
        create_engine("kokoro-v1_0-en-zh")
    with pytest.raises(ValueError):
        create_engine("sherpa-piper-en", 3)
    with pytest.raises(ValueError):
        create_engine("kokoro-v1_1-int8-zh", 999)
    engine = create_engine("kokoro-v1_1-int8-zh", 3)
    assert engine.decode_params()["speaker"] == "zf_001"
    assert create_engine("kokoro-v1_0-en-zh", 52).decode_params()["speaker"] == "zm_yunyang"
