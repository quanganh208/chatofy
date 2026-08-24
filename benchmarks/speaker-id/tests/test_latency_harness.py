"""Tests for the latency harness's pure logic.

The timing itself cannot be asserted — that is the measurement. What CAN go
wrong silently is the machinery around it: a percentile that reads the wrong
element, a thread "recommendation" that ranges over the wrong axis, or a verdict
that reports a pass because nothing relevant was measured. Those produce a
confident number with nothing behind it.

Written to be mutation-resistant. A review found an earlier version where four
of five deliberate mutations — deleting the duration filter, hardcoding FITS,
flipping min to max, and replacing p95 with the median — all passed the suite.
Each now has a test that fails.
"""

from __future__ import annotations

import pytest

import run_latency


def test_percentile_never_sits_below_the_percentile_it_claims() -> None:
    """The bug this replaced: `round(f * (n-1))` returns the 2nd-largest of 12.

    That is roughly the 87th percentile while being labelled p95 — it understates
    the tail, and the tail is what the gate turns on.
    """
    values = [float(v) for v in range(1, 13)]  # n=12, the old REPS
    result = run_latency.percentile(values, 0.95)
    assert result == 12.0, "p95 of 12 samples must be the largest, not the second-largest"

    naive = sorted(values)[min(11, max(0, int(round(0.95 * 11))))]
    assert naive == 11.0 and result > naive


def test_percentile_is_a_real_observation() -> None:
    values = [float(v) for v in range(1, 101)]
    assert run_latency.percentile(values, 0.95) == 95.0
    assert run_latency.percentile(values, 1.0) == 100.0
    assert run_latency.percentile(values, 0.0) == 1.0


def test_percentile_rejects_an_empty_sequence() -> None:
    with pytest.raises(ValueError):
        run_latency.percentile([], 0.95)


@pytest.mark.parametrize("fraction", [0.0, 0.5, 0.95, 1.0])
def test_percentile_never_indexes_out_of_range(fraction: float) -> None:
    for size in (1, 2, 3, 12, 50):
        values = [float(v) for v in range(size)]
        assert run_latency.percentile(values, fraction) in values


def test_speech_like_is_deterministic_and_right_length() -> None:
    a = run_latency.speech_like(2.0)
    b = run_latency.speech_like(2.0)
    assert len(a) == 2 * run_latency.SAMPLE_RATE
    assert (a == b).all(), "same seed must give same audio, or timings are not comparable"
    assert float(abs(a).mean()) > 0.05, "silence could be short-circuited; timings would lie"


def test_discover_models_returns_only_files_that_exist(tmp_path) -> None:
    assert run_latency.discover_models(tmp_path) == {}
    (tmp_path / "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx").write_bytes(b"x")
    assert set(run_latency.discover_models(tmp_path)) == {"campplus"}


def _row(**kwargs) -> run_latency.Row:
    defaults = dict(
        model="m",
        condition="idle",
        stt_threads=0,
        stt_instances=0,
        extractor_threads=run_latency.GATED_THREADS,
        duration_s=run_latency.RECOMMENDATION_DURATION_S,
        p50_ms=100.0,
        p95_ms=120.0,
        min_ms=90.0,
        max_ms=130.0,
        reps=50,
        fits_window=True,
        host="host",
        cpus=16,
        omp_threads="4",
    )
    defaults.update(kwargs)
    return run_latency.Row(**defaults)


# --- acceptance criterion 3: the thread recommendation ----------------------


def test_recommendation_compares_threads_at_one_fixed_duration() -> None:
    """The defect this replaced named the LOSING configuration.

    Ranging over durations and threads together makes the minimum the shortest
    input, so the reported "best threads" was whichever won at 1s. For
    eres2netv2 under contention that pointed at thr=2 while thr=2 was the worst
    of the three at the deciding 3s cell.
    """
    rows = [
        # 1s cells: thr=8 is fastest here and must NOT decide the answer.
        _row(duration_s=1.0, extractor_threads=8, p95_ms=10.0),
        _row(duration_s=1.0, extractor_threads=1, p95_ms=30.0),
        # 3s cells: thr=1 wins where it counts.
        _row(duration_s=3.0, extractor_threads=8, p95_ms=500.0),
        _row(duration_s=3.0, extractor_threads=1, p95_ms=400.0),
    ]
    threads, p95 = run_latency.recommend_threads(rows)[("m", "idle")]
    assert threads == 1, "recommendation must come from the fixed duration, not the fastest cell"
    assert p95 == 400.0


def test_recommendation_picks_the_minimum_not_the_maximum() -> None:
    rows = [
        _row(extractor_threads=1, p95_ms=400.0),
        _row(extractor_threads=2, p95_ms=200.0),
        _row(extractor_threads=8, p95_ms=300.0),
    ]
    assert run_latency.recommend_threads(rows)[("m", "idle")][0] == 2


def test_recommendation_is_per_condition() -> None:
    """More threads win idle; fewer win under contention. One answer hides that."""
    rows = [
        _row(condition="idle", extractor_threads=8, p95_ms=70.0),
        _row(condition="idle", extractor_threads=2, p95_ms=150.0),
        _row(condition="contended-stt4", extractor_threads=8, p95_ms=230.0),
        _row(condition="contended-stt4", extractor_threads=2, p95_ms=200.0),
    ]
    best = run_latency.recommend_threads(rows)
    assert best[("m", "idle")][0] == 8
    assert best[("m", "contended-stt4")][0] == 2


def test_verdict_prints_a_thread_recommendation(capsys) -> None:
    """Criterion 3 is a deliverable — it must reach the artifact, not merely exist."""
    run_latency.verdict([_row(p95_ms=200.0)])
    assert "RECOMMENDED extractor num_threads" in capsys.readouterr().out


# --- the gate bar -----------------------------------------------------------


def test_verdict_fails_when_the_recommended_config_exceeds() -> None:
    over = run_latency.TRANSLATION_WINDOW_MS + 100
    assert run_latency.verdict([_row(p95_ms=over, fits_window=False)]) == 1


def test_verdict_fails_a_model_that_only_fits_at_ungated_thread_counts() -> None:
    """The false clean the original bar allowed.

    "Any configuration fits" passed a model that only fits at 8 threads — a
    setting the design forbids and this system will never run.
    """
    over = run_latency.TRANSLATION_WINDOW_MS + 100
    rows = [
        _row(extractor_threads=8, p95_ms=50.0, fits_window=True),
        _row(extractor_threads=run_latency.GATED_THREADS, p95_ms=over, fits_window=False),
    ]
    assert run_latency.verdict(rows) == 1


def test_verdict_passes_when_the_recommended_config_fits() -> None:
    rows = [
        _row(extractor_threads=1, p95_ms=900.0, fits_window=False),
        _row(extractor_threads=run_latency.GATED_THREADS, p95_ms=200.0, fits_window=True),
    ]
    assert run_latency.verdict(rows) == 0


def test_dev_only_condition_cannot_fail_the_gate() -> None:
    """`contended-stt8` is dev parity; production runs 4."""
    over = run_latency.TRANSLATION_WINDOW_MS + 500
    rows = [
        _row(condition="contended-stt4", p95_ms=200.0, fits_window=True),
        _row(condition="contended-stt8", p95_ms=over, fits_window=False),
    ]
    assert run_latency.verdict(rows) == 0


def test_the_duration_filter_actually_filters(capsys) -> None:
    """Guards the deleted-filter mutation.

    An earlier test claimed to check this and did not: its `== 0` assertion held
    whether or not the filter existed. This asserts on the PRINTED span, which
    changes the moment a 5s cell is allowed into the comparison.
    """
    rows = [
        _row(duration_s=3.0, p95_ms=200.0, fits_window=True),
        _row(duration_s=5.0, p95_ms=5000.0, fits_window=False),
    ]
    assert run_latency.verdict(rows) == 0
    output = capsys.readouterr().out
    assert "5000" not in output, "a 5s cell leaked into the 1-3s verdict line"
    assert "200.0" in output


def test_a_thin_fit_passes_but_is_reported_marginal(capsys) -> None:
    """Fitting by a hair is inside the noise, not a clean pass."""
    thin = run_latency.TRANSLATION_WINDOW_MS * 0.95
    assert run_latency.verdict([_row(p95_ms=thin, fits_window=True)]) == 0
    assert "MARGINAL" in capsys.readouterr().out


def test_a_comfortable_fit_is_not_reported_marginal(capsys) -> None:
    """Guards hardcoded labels from the other side.

    Without this, a verdict printing MARGINAL unconditionally would satisfy the
    test above and nothing would notice.
    """
    assert run_latency.verdict([_row(p95_ms=50.0, fits_window=True)]) == 0
    output = capsys.readouterr().out
    assert "FITS" in output and "MARGINAL" not in output


def test_verdict_survives_a_condition_with_no_realistic_turns() -> None:
    """Without the guard this raises ValueError from min() on an empty sequence."""
    assert run_latency.verdict([_row(duration_s=5.0, p95_ms=200.0, fits_window=True)]) == 0


# --- acceptance criterion 5: the concurrency ceiling ------------------------


def test_ceiling_is_reported_as_unestablished_at_one_instance(capsys) -> None:
    run_latency.verdict([_row(condition="contended-stt4", stt_instances=1)])
    assert "CONCURRENCY CEILING NOT ESTABLISHED" in capsys.readouterr().out


def test_ceiling_is_established_at_the_architectural_maximum(capsys) -> None:
    """Two engines, one lock each, so two concurrent decodes is the real ceiling."""
    rows = [_row(condition="contended-stt4", stt_instances=run_latency.MAX_CONCURRENT_DECODES)]
    run_latency.verdict(rows)
    output = capsys.readouterr().out
    assert "CONCURRENCY CEILING:" in output
    assert "NOT ESTABLISHED" not in output


# --- the two cell-level decisions, reachable directly -----------------------
#
# Both of these previously survived mutation. `fits_window` was only reachable
# through a real measurement run, and the marginal-label test matched the
# run-level summary line instead of the per-condition line it meant to check.


def test_fits_window_is_a_strict_comparison_against_the_window() -> None:
    window = run_latency.TRANSLATION_WINDOW_MS
    assert run_latency.fits_window(window - 1) is True
    assert run_latency.fits_window(window) is False, "a cell exactly at the window does not fit"
    assert run_latency.fits_window(window + 1) is False


def test_headroom_is_negative_when_the_window_is_exceeded() -> None:
    window = run_latency.TRANSLATION_WINDOW_MS
    assert run_latency.headroom(window / 2) == pytest.approx(0.5)
    assert run_latency.headroom(window * 2) < 0


@pytest.mark.parametrize(
    "fraction, expected",
    [
        (0.10, "FITS"),       # 90% headroom
        (0.50, "FITS"),       # 50% headroom
        (0.95, "MARGINAL"),   # 5% headroom, inside the noise
        (1.00, "EXCEEDS"),    # exactly at the window
        (1.50, "EXCEEDS"),
    ],
)
def test_classify_bands(fraction: float, expected: str) -> None:
    assert run_latency.classify(run_latency.TRANSLATION_WINDOW_MS * fraction) == expected


def _gate_line(output: str, condition: str) -> str:
    """The one printed line for a condition — not the run-level summary.

    Asserting against the whole blob is how the previous marginal test passed a
    mutant: `PASS (MARGINAL)` in the summary satisfied a substring check while
    the per-condition label was wrong.
    """
    for line in output.splitlines():
        # Anchored on the row PREFIX. A substring search matched the header
        # ("gated on: ... conditions=idle/... Other rows are diagnostics.")
        # because it contains both the condition name and "diag".
        stripped = line.strip()
        if not (stripped.startswith("GATE ") or stripped.startswith("diag ")):
            continue
        if stripped.split()[1] == condition:
            return line
    raise AssertionError(f"no per-condition line for {condition!r} in:\n{output}")


def test_the_condition_line_itself_says_marginal(capsys) -> None:
    thin = run_latency.TRANSLATION_WINDOW_MS * 0.95
    run_latency.verdict([_row(condition="idle", p95_ms=thin, fits_window=True)])
    line = _gate_line(capsys.readouterr().out, "idle")
    assert line.rstrip().endswith("MARGINAL"), line


def test_the_condition_line_itself_says_fits(capsys) -> None:
    run_latency.verdict([_row(condition="idle", p95_ms=50.0, fits_window=True)])
    line = _gate_line(capsys.readouterr().out, "idle")
    assert line.rstrip().endswith("FITS"), line


def test_the_condition_line_itself_says_exceeds(capsys) -> None:
    over = run_latency.TRANSLATION_WINDOW_MS + 100
    run_latency.verdict([_row(condition="idle", p95_ms=over, fits_window=False)])
    line = _gate_line(capsys.readouterr().out, "idle")
    assert line.rstrip().endswith("EXCEEDS"), line
