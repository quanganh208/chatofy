import time

import pytest

from stt_bench.metrics import PeakRssSampler, corpus_wer, latency_stats, rtf


def test_corpus_wer_identical_after_normalization():
    # Punctuation/case differences must not count as errors.
    assert corpus_wer(["Xin chào!"], ["xin chào"]) == 0.0


def test_corpus_wer_counts_substitutions():
    # 1 substitution over 4 reference words.
    assert corpus_wer(["một hai ba bốn"], ["một hai ba năm"]) == pytest.approx(0.25)


def test_corpus_wer_rejects_length_mismatch():
    with pytest.raises(ValueError):
        corpus_wer(["a"], ["a", "b"])


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
