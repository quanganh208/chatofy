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


def test_teens_read_regular_except_fifteen():
    assert verbalize_vi("11") == "mười một"
    assert verbalize_vi("14") == "mười bốn"
    assert verbalize_vi("15") == "mười lăm"


def test_colloquial_fourteen_matches_the_written_digits():
    assert normalize_text("mười tư", language="vi") == normalize_text("14", language="vi")


def test_round_groups_are_silent():
    assert verbalize_vi("1000") == "một nghìn"
    assert verbalize_vi("2000") == "hai nghìn"
    assert verbalize_vi("1000000") == "một triệu"
    assert verbalize_vi("1.000.005") == "một triệu không trăm linh năm"


def test_decimal_keeps_leading_zeros():
    assert verbalize_vi("2,05") == "hai phẩy không năm"
    assert verbalize_vi("2,05") != verbalize_vi("2,5")


def test_comma_list_reads_each_number_instead_of_raising():
    assert verbalize_vi("1,2,3") == "một hai ba"
    assert verbalize_vi("1,2.5") == "một hai năm"
