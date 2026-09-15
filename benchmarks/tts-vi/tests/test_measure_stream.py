"""Coverage for the underrun metric, which the TTFA conclusion rests on.

`measure_stream` decides whether a fast first chunk is a real win or a stall
dressed as one. A sign error or an off-by-one in where `total_samples` is read
would flip the central comparison in the report, so it is pinned here against a
fake engine whose chunk timing is controlled exactly.
"""

import time

import numpy as np
import pytest

from tts_vi_bench.run_engine import measure_stream

SR = 48000


class FakeStreamingEngine:
    """Yields chunks of a stated audio length, each after a stated wall delay."""

    def __init__(self, schedule: list[tuple[float, float]]):
        # (seconds to generate this chunk, seconds of audio it carries)
        self._schedule = schedule
        self.sample_rate = SR

    def synthesize_stream(self, text: str, voice: str):
        for gen_s, audio_s in self._schedule:
            time.sleep(gen_s)
            yield np.zeros(int(audio_s * SR), dtype=np.float32)


def test_a_stream_that_stays_ahead_reports_a_negative_margin():
    """Each chunk generated far faster than the audio it carries: no underrun."""
    engine = FakeStreamingEngine([(0.01, 0.5)] * 4)
    out = measure_stream(engine, "x", "v")
    assert out["stream_chunks"] == 4
    assert out["stream_underrun_margin_s"] < 0, "a stream running ahead must be negative"
    assert out["stream_audio_s"] == pytest.approx(2.0, abs=0.01)


def test_a_stream_that_falls_behind_reports_a_positive_margin():
    """First chunk is tiny, the next takes far longer than it can cover."""
    engine = FakeStreamingEngine([(0.01, 0.05), (0.40, 0.05), (0.01, 0.5)])
    out = measure_stream(engine, "x", "v")
    # After chunk 1 the listener has 50 ms of audio; chunk 2 arrives ~400 ms
    # later, so playback ran dry for roughly 350 ms.
    assert out["stream_underrun_margin_s"] > 0.2


def test_ttfa_is_the_first_chunk_not_the_whole_stream():
    engine = FakeStreamingEngine([(0.05, 0.5), (0.30, 0.5)])
    out = measure_stream(engine, "x", "v")
    assert out["stream_ttfa_s"] == pytest.approx(0.05, abs=0.04)
    assert out["stream_total_s"] > out["stream_ttfa_s"]


def test_the_margin_is_measured_from_first_audio_not_from_the_call():
    """A slow first chunk must not be charged again as an underrun.

    Playback starts when the listener first hears something. Measuring the
    margin from t0 would count the time-to-first-audio twice and report a stall
    on a stream that never stalled — the specific error this guards.
    """
    engine = FakeStreamingEngine([(0.30, 0.5), (0.01, 0.5)])
    out = measure_stream(engine, "x", "v")
    assert out["stream_ttfa_s"] == pytest.approx(0.30, abs=0.05)
    assert out["stream_underrun_margin_s"] < 0, (
        "the 300 ms first chunk is TTFA, not a shortfall"
    )


def test_empty_chunks_do_not_start_the_clock():
    engine = FakeStreamingEngine([(0.02, 0.0), (0.02, 0.5)])
    out = measure_stream(engine, "x", "v")
    assert out["stream_chunks"] == 1, "a zero-length chunk is not audio"
    assert out["stream_ttfa_s"] >= 0.03


def test_a_single_chunk_stream_has_no_margin_to_report():
    engine = FakeStreamingEngine([(0.02, 0.5)])
    out = measure_stream(engine, "x", "v")
    assert out["stream_chunks"] == 1
    assert out["stream_underrun_margin_s"] is None
