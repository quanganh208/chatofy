import time

import pytest

from stt_bench.metrics import PeakRssSampler, corpus_cer, corpus_wer, latency_stats, rtf


def test_corpus_wer_identical_after_normalization():
    # Punctuation/case differences must not count as errors.
    assert corpus_wer(["Xin chào!"], ["xin chào"]) == 0.0


def test_corpus_wer_counts_substitutions():
    # 1 substitution over 4 reference words.
    assert corpus_wer(["một hai ba bốn"], ["một hai ba năm"]) == pytest.approx(0.25)


def test_corpus_wer_rejects_length_mismatch():
    with pytest.raises(ValueError):
        corpus_wer(["a"], ["a", "b"])


def test_corpus_cer_identical_after_normalization():
    # CER shares WER's normalization, so formatting is not an error here either.
    assert corpus_cer(["Xin chào!"], ["xin chào"]) == 0.0


def test_corpus_cer_counts_one_dropped_character():
    # "một" -> "mộ": a single deletion over 3 reference characters.
    assert corpus_cer(["một"], ["mộ"]) == pytest.approx(1 / 3)


def test_corpus_cer_rejects_length_mismatch():
    with pytest.raises(ValueError):
        corpus_cer(["a"], ["a", "b"])


def test_cer_separates_a_near_miss_that_wer_charges_in_full():
    # A real r1 row: sherpa-zipformer-vi heard "QUẢNG" as "QUẢN". WER cannot see
    # that the word was one character away, so it charges a full substitution;
    # CER prices the same error at one character. This gap is the reason vi is
    # read on both metrics.
    ref = ["BÀ QUẢNG VẪN ĐANG BẬN RỘN"]
    hyp = ["BÀ QUẢN VẪN ĐANG BẬN RỘN"]
    assert corpus_wer(ref, hyp) == pytest.approx(1 / 6)
    assert corpus_cer(ref, hyp) == pytest.approx(1 / 25)


def test_cer_charges_a_dropped_space_as_an_error():
    # Word-boundary errors must not be free: normalization collapses runs of
    # whitespace but never removes the separator itself.
    assert corpus_cer(["ba bon"], ["babon"]) == pytest.approx(1 / 6)


def test_rtf():
    assert rtf(2.0, 10.0) == pytest.approx(0.2)
    with pytest.raises(ValueError):
        rtf(1.0, 0.0)


def test_latency_stats():
    stats = latency_stats([1.0, 2.0, 3.0, 4.0])
    assert stats["mean_s"] == pytest.approx(2.5)
    assert stats["p50_s"] == pytest.approx(2.5)
    assert 3.0 < stats["p95_s"] <= 4.0
    with pytest.raises(ValueError):
        latency_stats([])


def test_peak_rss_sampler_reports_positive_peak():
    sampler = PeakRssSampler(interval_s=0.01).start()
    # Allocate ~50MB so the peak visibly includes live memory.
    blob = bytearray(50 * 1024 * 1024)
    time.sleep(0.05)
    peak_mb = sampler.stop()
    assert peak_mb > 10
    del blob
