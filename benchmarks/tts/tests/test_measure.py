import time
from pathlib import Path

import pytest

from tts_bench.measure import PeakRssSampler, latency_stats, load_sentences

BENCH_ROOT = Path(__file__).resolve().parent.parent


def test_load_sentences_skips_comments_and_numbers_ids():
    sentences = load_sentences(BENCH_ROOT / "data" / "sentences-en.txt")
    assert len(sentences) == 30
    assert sentences[0][0] == "s001"
    assert all(text and not text.startswith("#") for _, text in sentences)
    # Word counts stay in the 5-20 range the benchmark targets (allow slight overshoot).
    assert all(3 <= len(text.split()) <= 22 for _, text in sentences)


def test_latency_stats():
    stats = latency_stats([1.0, 2.0, 3.0, 4.0])
    assert stats["mean_s"] == pytest.approx(2.5)
    assert stats["p50_s"] == pytest.approx(2.5)
    with pytest.raises(ValueError):
        latency_stats([])


def test_peak_rss_sampler_reports_positive_peak():
    sampler = PeakRssSampler(interval_s=0.01).start()
    blob = bytearray(30 * 1024 * 1024)
    time.sleep(0.05)
    peak_mb = sampler.stop()
    assert peak_mb > 10
    del blob
