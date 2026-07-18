import unicodedata

from stt_bench.text_normalize import normalize_text


def test_lowercases_and_strips_punctuation():
    assert normalize_text("Hello, World!") == "hello world"


def test_preserves_vietnamese_diacritics():
    assert normalize_text("Xin chào, tôi tên là Đức.") == "xin chào tôi tên là đức"


def test_nfc_composition_makes_decomposed_input_equal():
    composed = "tiếng việt"
    decomposed = unicodedata.normalize("NFD", composed)
    assert normalize_text(decomposed) == normalize_text(composed)


def test_collapses_whitespace_and_underscores():
    assert normalize_text("  a\t b_c \n d  ") == "a b c d"


def test_keeps_digits():
    assert normalize_text("Phòng 302!") == "phòng 302"
