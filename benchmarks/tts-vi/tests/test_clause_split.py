"""The ported splitter must agree with the app's, including its edge cases.

These are the cases `apps/api/src/modules/translate/audio/clause-splitter.ts`
calls out in its own comments. If the app's rule changes and this port does not,
a test here fails rather than the TTFA baseline quietly drifting.
"""

from tts_vi_bench.clause_split import split_into_clauses


def test_blank_input_yields_nothing():
    assert split_into_clauses("") == []
    assert split_into_clauses("   ") == []


def test_text_without_a_boundary_stays_one_part():
    assert split_into_clauses("Xin chào các bạn") == ["Xin chào các bạn"]


def test_splits_at_a_comma_keeping_the_mark():
    assert split_into_clauses("Xin chào, cái này giá bao nhiêu?") == [
        "Xin chào,",
        "cái này giá bao nhiêu?",
    ]


def test_the_decimal_comma_is_not_a_boundary():
    """"1,5 triệu" must stay whole — the lookahead requires whitespace or end."""
    assert split_into_clauses("Giá khoảng 1,5 triệu đồng") == ["Giá khoảng 1,5 triệu đồng"]


def test_a_decimal_point_is_not_a_boundary():
    assert split_into_clauses("Phiên bản 3.5 mới ra") == ["Phiên bản 3.5 mới ra"]


def test_short_fragments_are_absorbed_into_their_neighbour():
    """"Mr." is below MIN_PART_CHARS, so it must not cost its own call."""
    assert split_into_clauses("Mr. Smith đang đợi") == ["Mr. Smith đang đợi"]


def test_a_leading_clause_above_the_floor_still_splits():
    """The measured win came from leading clauses this short; do not merge them."""
    assert split_into_clauses("Xin chào, tôi tên là Nam") == ["Xin chào,", "tôi tên là Nam"]


def test_multiple_boundaries_produce_multiple_parts():
    assert split_into_clauses(
        "Tôi đến đây lần đầu, nên anh gợi ý giúp tôi vài món ăn đặc trưng nhé."
    ) == [
        "Tôi đến đây lần đầu,",
        "nên anh gợi ý giúp tôi vài món ăn đặc trưng nhé.",
    ]


def test_runs_of_punctuation_are_kept_together():
    assert split_into_clauses("Thật sao?! Tôi không tin") == [
        "Thật sao?!",
        "Tôi không tin",
    ]
