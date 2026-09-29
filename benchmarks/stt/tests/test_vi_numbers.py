from stt_bench.text_normalize import normalize_text
from stt_bench.vi_numbers import canonicalize_vi_number_words, verbalize_vi


def test_verbalize_25_then_canonicalize_matches_the_spoken_form():
    spoken = verbalize_vi("25")
    assert spoken == "hai mươi lăm"
    assert canonicalize_vi_number_words(spoken) == canonicalize_vi_number_words("hai mươi lăm")
    assert canonicalize_vi_number_words(spoken) == "hai mươi năm"


def test_verbalize_105_with_the_linh_filler():
    assert verbalize_vi("105") == "một trăm linh năm"


def test_verbalize_thousands_separator():
    assert verbalize_vi("2.500") == "hai nghìn năm trăm"


def test_verbalize_decimal_comma():
    assert verbalize_vi("2,5") == "hai phẩy năm"


def test_21_matches_the_written_spoken_form_after_canonicalizing():
    assert canonicalize_vi_number_words(verbalize_vi("21")) == canonicalize_vi_number_words(
        "hai mươi mốt"
    )


def test_canonicalize_le_becomes_linh():
    assert canonicalize_vi_number_words("một trăm lẻ năm") == "một trăm linh năm"


def test_canonicalize_leaves_non_number_context_lam_unchanged():
    # "lăm" not preceded by "mười"/"mươi" is not a tens-digit reading; leave it.
    assert canonicalize_vi_number_words("tôi lăm le") == "tôi lăm le"


def test_normalize_text_default_path_keeps_digits_unchanged():
    assert normalize_text("phòng 302") == "phòng 302"


def test_normalize_text_vi_path_normalizes_numbers_on_both_sides():
    ref = normalize_text("phòng 25", language="vi")
    hyp = normalize_text("phòng hai mươi lăm", language="vi")
    assert ref == hyp


def test_normalize_text_vi_path_collapses_spoken_variant():
    written = normalize_text("hai mươi năm", language="vi")
    spoken = normalize_text("hai mươi lăm", language="vi")
    assert written == spoken
