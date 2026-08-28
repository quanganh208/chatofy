"""Display-fidelity metric tests.

The cases that matter are the ones where a naive implementation looks right:
a Vietnamese decimal comma counted as a clause boundary, an ITN pass turning the
negation `không` into `0`, and a punctuation metric that counts marks instead of
placing them.
"""

import unicodedata
from dataclasses import fields

from stt_bench.display_fidelity import (
    DisplayCounts,
    score_corpus,
    score_utterance,
    summarize,
)


def fidelity(reference: str, hypothesis: str, proper_nouns: list[str] | None = None):
    return summarize(score_utterance(reference, hypothesis, proper_nouns))


# --- numerals ---------------------------------------------------------------


def test_numeral_forms_survive_as_single_tokens():
    # Scored against a hypothesis that mangles ONE form, not against itself:
    # ref == hyp makes recall 1.0 and hallucinations 0 for any tokenizer at all,
    # which would leave a broken separator class invisible.
    reference = "Ngày 2/9/1945, họp lúc 17:00, mực nước 0,4 m trong 30 phút."
    mangled = "Ngày 2/9/1945, họp lúc 17.00, mực nước 0,4 m trong 30 phút."
    result = fidelity(reference, mangled)
    assert result.counts.numerals_in_reference == 4
    assert result.numeral_recall == 0.75
    assert result.numeral_hallucinations == 1


def test_a_decimal_comma_is_part_of_the_number_not_punctuation():
    # One clause comma, one decimal comma, one terminal period. The decimal
    # comma must not appear as a third mark, and dropping it from the number
    # must cost recall — so the hypothesis spells that number out.
    reference = "Mực nước 0,4 m, đo lúc sáng."
    result = fidelity(reference, "Mực nước không phẩy bốn m, đo lúc sáng.")
    assert result.counts.punctuation_in_reference == 2
    assert result.counts.punctuation_in_hypothesis == 2
    assert result.numeral_recall == 0.0


def test_decimal_comma_and_decimal_point_are_different_numerals():
    result = fidelity("Mực nước 0,4 m.", "Mực nước 0.4 m.")
    assert result.numeral_recall == 0.0
    assert result.numeral_hallucinations == 1


def test_a_separator_only_joins_digits_to_digits():
    # Vietnamese groups thousands with dots, so `1.000.000` is ONE numeral — but
    # the period ending `... năm 1945.` is punctuation, not part of the year.
    result = fidelity("Giá 1.000.000 đồng năm 1945.", "Giá 1.000.000 đồng năm 1945.")
    assert result.counts.numerals_in_reference == 2
    assert result.counts.punctuation_in_reference == 1
    assert result.numeral_recall == 1.0


def test_spelled_out_number_scores_zero_rather_than_being_credited():
    result = fidelity("Họp lúc 17:00.", "Họp lúc mười bảy giờ.")
    assert result.numeral_recall == 0.0
    assert result.numeral_hallucinations == 0


def test_negation_converted_to_a_digit_is_a_hallucination():
    # "không" is the word "not" here, not the digit zero. An over-eager ITN pass
    # that rewrites it corrupts the sentence, and must be visible as such.
    result = fidelity("Tôi không phải người Hà Nội.", "Tôi 0 phải người Hà Nội.")
    assert result.numeral_hallucinations == 1
    # The reference declares no numeral, so there is nothing to recall — and an
    # absent signal must never be reported as a perfect score.
    assert result.numeral_recall is None


# --- punctuation ------------------------------------------------------------


def test_punctuation_scores_placement_not_count():
    reference = "Hôm nay, trời đẹp."
    misplaced = "Hôm, nay trời đẹp."
    result = fidelity(reference, misplaced)
    assert result.counts.punctuation_in_hypothesis == 2
    assert result.punctuation_precision == 0.5
    assert result.punctuation_recall == 0.5
    assert result.punctuation_f1 == 0.5


def test_todays_output_has_no_punctuation_at_all():
    result = fidelity("Hôm nay, trời đẹp.", "hôm nay trời đẹp")
    assert result.punctuation_recall == 0.0
    assert result.punctuation_precision is None
    assert result.punctuation_f1 == 0.0


def test_invented_punctuation_against_a_bare_reference_scores_zero():
    result = fidelity("Hôm nay trời đẹp", "Hôm, nay trời đẹp.")
    assert result.punctuation_precision == 0.0
    # `None`, not 0.0 — the reference declared no placement to recall. Asserting
    # the F1 alone would also pass if `_ratio` returned 0.0 for an absent
    # denominator, which is the distinction this module is built on.
    assert result.punctuation_recall is None
    assert result.punctuation_f1 == 0.0


def test_f1_is_harmonic_not_arithmetic():
    # The only other test with both P and R nonzero has P == R, where the two
    # means coincide — so nothing else pins the module's headline formula.
    reference = "Hôm nay, trời đẹp hôm qua, trời mưa."
    result = fidelity(reference, "Hôm nay, trời đẹp hôm qua trời mưa")
    assert result.punctuation_precision == 1.0
    assert result.punctuation_recall == 1 / 3
    assert result.punctuation_f1 == 0.5  # arithmetic mean would give 0.667


def test_a_comma_is_not_a_period_at_the_same_anchor():
    # Confusing one mark for another at the right position is exactly what a
    # punctuation-restoration model gets wrong, so it must not score as a match.
    result = fidelity("Hôm nay.", "Hôm nay,")
    assert result.counts.punctuation_matched == 0
    assert result.punctuation_f1 == 0.0


def test_a_run_of_the_same_mark_counts_once():
    # A reader sees one ellipsis, not three periods.
    assert fidelity("Xong...", "Xong...").punctuation_f1 == 1.0
    result = fidelity("Xong...", "Xong.")
    assert result.counts.punctuation_in_reference == 1
    assert result.punctuation_f1 == 1.0


def test_a_leading_mark_anchors_to_the_sentence_start():
    result = fidelity(", mở đầu", ", mở đầu")
    assert result.counts.punctuation_in_reference == 1
    assert result.punctuation_f1 == 1.0
    # Not the same placement as the same mark after the first word.
    assert fidelity(", mở đầu", "mở, đầu").punctuation_f1 == 0.0


def test_no_punctuation_on_either_side_is_unscoreable_not_perfect():
    result = fidelity("hôm nay trời đẹp", "hôm nay trời đẹp")
    assert result.punctuation_f1 is None


# --- proper nouns -----------------------------------------------------------


def test_proper_noun_capitalization():
    nouns = ["Hồ Chí Minh", "Ba Đình"]
    correct = fidelity("x", "Chủ tịch Hồ Chí Minh tại Ba Đình.", nouns)
    assert correct.proper_noun_coverage == 1.0
    assert correct.proper_noun_accuracy == 1.0

    lowercased = fidelity("x", "chủ tịch hồ chí minh tại ba đình", nouns)
    assert lowercased.proper_noun_coverage == 1.0
    assert lowercased.proper_noun_accuracy == 0.0


def test_a_misrecognized_noun_lowers_coverage_not_capitalization_accuracy():
    # Scoring casing over words the recognizer never produced would punish the
    # same acoustic miss twice and make this metric move with audio quality.
    nouns = ["Hồ Chí Minh", "Ba Đình"]
    result = fidelity("x", "Chủ tịch Hồ Chí Minh tại Ba Đinh.", nouns)
    assert result.proper_noun_coverage == 0.5
    assert result.proper_noun_accuracy == 1.0


def test_a_noun_listed_twice_matches_two_different_occurrences():
    # Re-matching the first occurrence would score the same correctly-cased word
    # twice and report 100% while half the sentence is lowercase.
    result = fidelity("x", "nước Việt Nam và nước việt nam", ["Việt Nam", "Việt Nam"])
    assert result.counts.proper_nouns_present == 2
    assert result.proper_noun_accuracy == 0.5


def test_a_noun_declared_once_cannot_be_present_twice():
    # Without the stop-after-first-match, a noun said twice would count twice
    # against a denominator of one and report a coverage rate above 1.0.
    result = fidelity("x", "Việt Nam và Việt Nam", ["Việt Nam"])
    assert result.counts.proper_nouns_present == 1
    assert result.proper_noun_coverage == 1.0


def test_an_empty_declared_noun_is_skipped_not_matched():
    # An empty string trivially matches the zero-width slice at any position,
    # which would score it as present AND correctly cased. Hand-authored
    # manifests produce these. The empty entry is listed LAST on purpose: listed
    # first it consumes position 0 and blocks the real noun, which happens to
    # produce the same present/correct totals and hides the defect.
    result = fidelity("x", "tại Hà Nội.", ["Hà Nội", ""])
    assert result.counts.proper_nouns_declared == 2
    assert result.counts.proper_nouns_present == 1
    assert result.proper_noun_coverage == 0.5
    assert result.proper_noun_accuracy == 1.0


def test_diacritics_are_part_of_the_noun_not_casing():
    result = fidelity("x", "Ba Dinh", ["Ba Đình"])
    assert result.proper_noun_coverage == 0.0
    assert result.proper_noun_accuracy is None


def test_decomposed_diacritics_match_composed_ones():
    # Browser-captured references arrive NFD often enough to matter, and the
    # corpus this scores is recorded through a browser by decision.
    composed = "Ba Đình"
    decomposed = unicodedata.normalize("NFD", composed)
    assert decomposed != composed
    result = fidelity("x", f"tại {decomposed}.", [composed])
    assert result.proper_noun_coverage == 1.0
    assert result.proper_noun_accuracy == 1.0
    assert fidelity(f"Ở {decomposed}.", "Ở Ba Đình.").punctuation_f1 == 1.0


# --- aggregation ------------------------------------------------------------


def test_corpus_aggregation_is_micro_not_a_mean_of_rates():
    pairs = [
        ("Lúc 17:00.", "Lúc 17:00.", []),
        ("Ngày 2/9/1945 lúc 17:00 trong 30 phút.", "ngày hai tháng chín lúc năm giờ.", []),
    ]
    result = score_corpus(pairs)
    # 1 of 4 numerals recovered corpus-wide. A mean of per-utterance rates would
    # read 0.50 and let the one-word utterance outweigh the three-numeral one.
    assert result.numeral_recall == 0.25
    assert result.counts.numerals_in_reference == 4


def test_counts_add_every_field_including_the_last():
    # Asserting a subset let a dropped field survive: the last one is
    # `proper_nouns_cased`, and losing it reports 0% capitalization on a corpus
    # whose nouns are all correct.
    left = DisplayCounts(*range(1, 10))
    right = DisplayCounts(*range(10, 19))
    total = left + right
    assert [getattr(total, f.name) for f in fields(total)] == [11, 13, 15, 17, 19, 21, 23, 25, 27]


def test_the_shipping_baseline_scores_zero_on_all_three_metrics():
    """Today's `postprocess()`: strip, lower, capitalize first character.

    This is the "before" the plan needs. Hypothesis is the real transcript of
    take-c, the best of the three real-voice recordings (4.3% WER against a
    spoken reference) — quality that good still scores zero here, which is the
    whole argument for measuring display separately from WER.
    """
    reference = (
        "Ngày 2/9/1945, tại Quảng trường Ba Đình lịch sử, Chủ tịch Hồ Chí Minh đọc "
        "Tuyên ngôn Độc lập, khai sinh nước Việt Nam dân chủ cộng hòa, nay là nước "
        "Cộng hòa xã hội chủ nghĩa Việt Nam."
    )
    hypothesis = (
        "Ngày mùng hai tháng chín năm một chín bốn lăm tại quảng trình ba đình lịch sử "
        "chủ tịch hồ chí minh được tuyên ngôn độc lập khai sinh nước việt nam dân chủ "
        "cộng hòa nay là nước cộng hòa xã hội chủ nghĩa việt nam"
    )
    result = fidelity(reference, hypothesis, ["Ba Đình", "Hồ Chí Minh", "Việt Nam"])

    assert result.numeral_recall == 0.0
    assert result.numeral_hallucinations == 0
    assert result.punctuation_f1 == 0.0
    assert result.proper_noun_accuracy == 0.0
