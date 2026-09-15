"""Metrics coverage, including the bootstrap that replaces the r1/r2 rule for WER."""

import pytest

from tts_vi_bench.metrics import (
    corpus_cer,
    corpus_wer,
    paired_bootstrap_wer,
    sentence_errors,
    win_loss_tie,
)
from tts_vi_bench.text_normalize import normalize_text


def test_normalizer_preserves_vietnamese_diacritics():
    """Casing and punctuation go; tone marks must not."""
    assert normalize_text("Xin chào, các bạn!") == "xin chào các bạn"
    assert normalize_text("ĐƯỜNG") == "đường"


def test_normalizer_composes_equivalent_unicode_forms():
    """NFC, so a decomposed and a composed 'ế' score as the same word."""
    assert normalize_text("ế") == normalize_text("ế")


def test_perfect_transcript_scores_zero():
    assert corpus_wer(["xin chào"], ["xin chào"]) == 0.0
    assert corpus_cer(["xin chào"], ["xin chào"]) == 0.0


def test_one_substitution_in_four_words():
    assert corpus_wer(["một hai ba bốn"], ["một hai ba năm"]) == pytest.approx(0.25)


def test_cer_separates_a_near_miss_from_a_miss():
    """The reason CER is reported beside WER on Vietnamese.

    Both hypotheses lose the same single word to WER; only CER shows that one
    missed by a tone mark and the other by a different word entirely.
    """
    assert corpus_wer(["cho tôi nước"], ["cho tôi nướt"]) == pytest.approx(1 / 3)
    assert corpus_wer(["cho tôi nước"], ["cho tôi bánh"]) == pytest.approx(1 / 3)
    assert corpus_cer(["cho tôi nước"], ["cho tôi nướt"]) < corpus_cer(
        ["cho tôi nước"], ["cho tôi bánh"]
    )


def test_ref_hyp_length_mismatch_is_an_error():
    with pytest.raises(ValueError, match="mismatch"):
        corpus_wer(["a", "b"], ["a"])


def test_sentence_errors_counts_edits_and_reference_length():
    edits, n_ref = sentence_errors("một hai ba bốn", "một hai ba năm")
    assert (edits, n_ref) == (1, 4)


def test_bootstrap_reports_a_tie_when_systems_are_identical():
    refs = [f"câu số {i} ở đây" for i in range(30)]
    out = paired_bootstrap_wer(refs, refs, refs, n_resamples=300)
    assert out["observed_diff"] == pytest.approx(0.0)
    assert not out["separates"], "identical systems must not separate"


def test_bootstrap_separates_a_clearly_better_system():
    refs = [f"một hai ba bốn năm câu {i}" for i in range(40)]
    good = list(refs)  # perfect
    bad = ["hoàn toàn sai khác biệt lắm rồi" for _ in refs]
    out = paired_bootstrap_wer(refs, good, bad, n_resamples=300)
    assert out["observed_diff"] < 0, "A is better, so the difference is negative"
    assert out["separates"]
    assert out["p_a_better"] == pytest.approx(1.0)


def test_win_loss_tie_counts_per_sentence_outcomes():
    refs = ["một hai", "ba bốn"]
    a = ["một hai", "sai hết"]
    b = ["sai rồi", "ba bốn"]
    assert win_loss_tie(refs, a, b) == {"a_wins": 1, "b_wins": 1, "ties": 0}
