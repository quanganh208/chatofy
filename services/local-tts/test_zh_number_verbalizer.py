"""The zh voice's digit reader. No model weights required."""
import pytest

from engines.zh_number_verbalizer import int_to_zh, verbalize_zh


@pytest.mark.parametrize(
    ("written", "spoken"),
    [
        # The benchmark's worst zh line read "15%" with English "percent".
        ("今年增长了15%。", "今年增长了百分之十五。"),
        ("增长了3.5％", "增长了百分之三点五"),
        ("价格是15.99元", "价格是十五点九九元"),
        ("会议在10:30开始", "会议在十点三十开始"),
        ("十点见，或者10:05", "十点见，或者十点零五"),
        ("我们9:00出发", "我们九点出发"),
        ("2026年", "二零二六年"),
        ("2026年10月13日", "二零二六年十月十三日"),
        ("截止日期是2026-10-13", "截止日期是二零二六年十月十三日"),
        # A leading zero is an identifier, read digit by digit.
        ("区号0912", "区号零九一二"),
        # Phone-length runs: digit by digit, 1 read 幺.
        ("电话13812345678", "电话幺三八幺二三四五六七八"),
        ("第3名", "第三名"),
        ("一共2,500元", "一共两千五百元"),
        ("我有2个问题", "我有两个问题"),
        ("房间402", "房间四百零二"),
        ("请升级到v1.13.4", "请升级到v一点十三点四"),
    ],
)
def test_verbalizes(written, spoken):
    assert verbalize_zh(written) == spoken


def test_text_with_no_digit_is_returned_unchanged():
    text = "我们明天去北京开会，好吗？"
    assert verbalize_zh(text) is text


@pytest.mark.parametrize(
    ("n", "spoken"),
    [(10, "十"), (15, "十五"), (105, "一百零五"), (2000, "两千"), (10005, "一万零五"), (0, "零")],
)
def test_cardinals(n, spoken):
    assert int_to_zh(n) == spoken
