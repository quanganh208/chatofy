import pytest

from stt_bench.metrics import corpus_cer
from stt_bench.text_normalize import normalize_text
from stt_bench.zh_numbers import digits_to_zh, int_to_zh, verbalize_zh


def zh(text: str) -> str:
    return normalize_text(text, language="zh")


def test_strips_full_and_half_width_punctuation_and_all_whitespace():
    assert zh("合金基本上由两种金属混合而成。不要忘记一点，元素！") == "合金基本上由两种金属混合而成不要忘记一点元素"
    assert zh("“政治碎碎念”（愚蠢）；钱德拉·谢卡尔 , ok?") == "政治碎碎念愚蠢钱德拉谢卡尔ok"


def test_space_separated_characters_equal_unspaced():
    assert zh("这 并 不 是 告 别") == zh("这并不是告别")


def test_nfkc_folds_full_width_latin_and_digits():
    assert zh("ＡＢＣ１２") == zh("abc12") == "abc十二"


def test_latin_is_lowercased_and_kept():
    assert zh("露娜 (Luna) 。") == "露娜luna"


def test_itn_and_spoken_numbers_score_the_same():
    written = "消防救援人员最终在晚上 11 点 35 分扑灭了大火。"
    spoken = "消防救援人员最终在晚上十一点三十五分扑灭了大火"
    assert zh(written) == zh(spoken)
    assert corpus_cer([written], [spoken], language="zh") == 0.0


def test_year_is_read_digit_by_digit():
    assert zh("1990 年，它被列入") == "一九九零年它被列入"
    assert zh("2017年9月") == "二零一七年九月"


def test_decimal_and_percent():
    assert verbalize_zh("3.14") == "三点一四"
    assert verbalize_zh("48%") == "百分之四十八"
    assert verbalize_zh("54.1%") == "百分之五十四点一"


def test_leading_zero_run_is_read_digit_by_digit():
    assert verbalize_zh("编号007") == "编号零零七"


def test_digit_free_text_is_unchanged():
    assert verbalize_zh("二十世纪的研究") == "二十世纪的研究"


@pytest.mark.parametrize(
    ("n", "spoken"),
    [
        (0, "零"),
        (7, "七"),
        (10, "十"),
        (15, "十五"),
        (20, "二十"),
        (105, "一百零五"),
        (110, "一百一十"),
        (1300, "一千三百"),
        (2023, "二千零二十三"),
        (10005, "一万零五"),
        (100000, "十万"),
        (120000, "十二万"),
        (1000000005, "十亿零五"),
        (100010000, "一亿零一万"),
    ],
)
def test_int_to_zh_cardinals(n, spoken):
    assert int_to_zh(n) == spoken


def test_int_to_zh_rejects_out_of_range():
    with pytest.raises(ValueError):
        int_to_zh(10**12)
    with pytest.raises(ValueError):
        int_to_zh(-1)


def test_digits_to_zh():
    assert digits_to_zh("1300") == "一三零零"


def test_cer_counts_characters_not_words():
    # One substituted character out of six.
    assert corpus_cer(["可能引发房价"], ["可能引发房假"], language="zh") == pytest.approx(1 / 6)


def test_other_languages_are_untouched_by_the_zh_branch():
    assert normalize_text("Phòng 302!") == "phòng 302"
    assert normalize_text("Hello, World!") == "hello world"
