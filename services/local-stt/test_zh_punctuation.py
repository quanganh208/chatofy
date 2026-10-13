"""The zh display restorer on its own: marks in, characters untouched."""
import re

import pytest

from punctuation.restorer import RestorerBusyError
from punctuation.zh_punctuation import ZhPunctuationRestorer, _keep_spaces

HAN = re.compile(r"[一-鿿]")


@pytest.fixture(scope="module")
def restorer():
    loaded = ZhPunctuationRestorer()
    loaded.load()
    if not loaded.loaded:
        pytest.skip("zh punctuation model not seeded; run scripts/download_models.py")
    return loaded


@pytest.mark.parametrize(
    "text",
    [
        "我们都是木头人不会说话不会动",
        "合金基本上由两种或以上金属混合而成不要忘记一点元素周期表上有很多元素",
        "消防救援人员最终在晚上十一点三十五分扑灭了大火",
    ],
)
def test_inserts_marks_and_keeps_every_han_character(restorer, text):
    restored = restorer.restore(text)
    assert HAN.findall(restored) == HAN.findall(text)
    assert re.search(r"[，。？！、]", restored)


def test_ends_a_sentence(restorer):
    assert restorer.restore("我们都是木头人不会说话不会动").endswith("。")


def test_blank_text_is_returned_as_is(restorer):
    assert restorer.restore("  ") == "  "


def test_a_held_model_refuses_with_busy(restorer):
    restorer._lock.acquire()
    try:
        with pytest.raises(RestorerBusyError):
            restorer.restore("我们明天去北京")
    finally:
        restorer._lock.release()


def test_an_unseeded_model_stays_unloaded(tmp_path):
    missing = ZhPunctuationRestorer(models_dir=tmp_path)
    missing.load()
    assert not missing.loaded


def test_keeps_the_spaces_around_latin_tokens(restorer):
    # The model drops them, which displayed `802.11a802.11b` after the ITN.
    text = "它能向后兼容八零二点一一 a 八零二点一一 b 和八零二点一一 g 前提是基站要有双无线电"
    restored = restorer.restore(text)
    assert "八零二点一一 a 八零二点一一 b 和八零二点一一 g" in restored


@pytest.mark.parametrize(
    ("source", "punctuated", "expected"),
    [
        ("一 a 二", "一a二。", "一 a 二。"),
        ("我们 hello 你好", "我们hello，你好。", "我们 hello，你好。"),
        ("我们去吧", "我们，去吧。", "我们，去吧。"),
        # A changed character: nothing lines up, so the model's text is returned.
        ("我们去吧", "我门去吧。", "我门去吧。"),
    ],
)
def test_keep_spaces(source, punctuated, expected):
    assert _keep_spaces(source, punctuated) == expected
