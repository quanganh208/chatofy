"""Tests for trial parsing, EER, and duration bucketing.

The EER tests matter more than they look. A threshold sweep that is subtly wrong
— off by one sample, wrong comparison direction, FAR and FRR swapped — still
returns a percentage in a believable range, and Checkpoint 1 would read a gate
decision off it without anything looking odd. So the central test checks against
an ANALYTIC value rather than a recorded one: for two equal-variance Gaussians
separated by d, the EER is exactly Phi(-d/2), independent of the sweep.
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from scipy.stats import norm

from speaker_bench.trials import (
    DURATION_BUCKETS_S,
    Trial,
    bucket_for,
    compute_eer,
    iter_scored,
    load_trials,
    parse_trial_line,
    split_scores,
    truncate_to,
)


# --- EER ------------------------------------------------------------------


@pytest.mark.parametrize("separation", [0.5, 1.0, 2.0, 3.0])
def test_eer_matches_analytic_gaussian_value(separation: float) -> None:
    """EER of two unit-variance Gaussians separated by d is Phi(-d/2).

    The sweep never sees this identity, so agreeing with it is real evidence
    rather than a restatement of the implementation.
    """
    rng = np.random.default_rng(20260824)
    n = 200_000
    target = rng.normal(loc=separation, scale=1.0, size=n)
    nontarget = rng.normal(loc=0.0, scale=1.0, size=n)

    result = compute_eer(target, nontarget)
    expected = float(norm.cdf(-separation / 2.0))

    # Sampling error at n=200k is well under 0.005 absolute.
    assert result.eer == pytest.approx(expected, abs=0.005), (
        f"d={separation}: got {result.eer:.4f}, analytic {expected:.4f}"
    )


def test_eer_threshold_sits_between_the_distributions() -> None:
    """The EER threshold is the crossing point, near d/2 for symmetric inputs."""
    rng = np.random.default_rng(7)
    target = rng.normal(loc=2.0, scale=1.0, size=50_000)
    nontarget = rng.normal(loc=0.0, scale=1.0, size=50_000)

    result = compute_eer(target, nontarget)

    assert result.threshold == pytest.approx(1.0, abs=0.1)
    assert result.far == pytest.approx(result.frr, abs=0.005)


def test_eer_is_zero_when_perfectly_separated() -> None:
    result = compute_eer(target_scores=[0.9, 0.95, 1.0], nontarget_scores=[0.0, 0.1, 0.2])
    assert result.eer == pytest.approx(0.0, abs=1e-9)


def test_eer_is_one_half_when_distributions_are_identical() -> None:
    """No separation at all must read 0.5, not something flatteringly lower."""
    rng = np.random.default_rng(11)
    scores = rng.normal(size=40_000)
    other = rng.normal(size=40_000)

    result = compute_eer(scores, other)

    assert result.eer == pytest.approx(0.5, abs=0.01)


def test_eer_is_one_half_when_scores_are_all_equal() -> None:
    """Degenerate input must not divide by zero or report a lucky 0%."""
    result = compute_eer(target_scores=[0.5] * 10, nontarget_scores=[0.5] * 10)
    assert result.eer == pytest.approx(0.5, abs=1e-9)


def test_eer_is_worse_than_half_when_the_score_is_inverted() -> None:
    """Guard the comparison direction.

    Higher score must mean more similar. If the sweep accepted `score <=
    threshold` instead, this inverted input would come back as a great EER and
    a real inversion bug in a bench would read as a passing gate.
    """
    result = compute_eer(target_scores=[0.0, 0.1, 0.2], nontarget_scores=[0.9, 0.95, 1.0])
    assert result.eer > 0.9


def test_eer_is_unchanged_when_every_score_is_duplicated() -> None:
    """Replication adds ties but no information, so the EER must not move.

    This is the sharp test for tie handling. A sweep that steps per SAMPLE
    rather than per DISTINCT score treats tied values as orderable and credits
    itself with separation the scores do not contain — and the error grows with
    the number of ties, so it is worst exactly where cosines are quantised.
    """
    rng = np.random.default_rng(101)
    target = np.round(rng.normal(loc=1.2, size=2_000), 2)
    nontarget = np.round(rng.normal(loc=0.0, size=2_000), 2)

    once = compute_eer(target, nontarget)
    five_times = compute_eer(np.tile(target, 5), np.tile(nontarget, 5))

    assert five_times.eer == pytest.approx(once.eer, abs=1e-12)


def test_eer_does_not_improve_when_scores_are_coarsely_quantised() -> None:
    """Rounding destroys information; it must never lower the EER.

    Under a tie-blind sweep it does, which is the failure this guards.
    """
    rng = np.random.default_rng(202)
    target = rng.normal(loc=1.0, size=5_000)
    nontarget = rng.normal(loc=0.0, size=5_000)

    fine = compute_eer(target, nontarget)
    coarse = compute_eer(np.round(target, 1), np.round(nontarget, 1))

    assert coarse.eer >= fine.eer - 0.01


def test_eer_counts_are_reported() -> None:
    result = compute_eer(target_scores=[1.0, 2.0], nontarget_scores=[0.0, 0.5, 0.7])
    assert (result.n_target, result.n_nontarget) == (2, 3)


@pytest.mark.parametrize(
    "target, nontarget",
    [([], [0.1]), ([0.1], []), ([], [])],
)
def test_eer_refuses_a_one_sided_input(target: list[float], nontarget: list[float]) -> None:
    """An empty side means the join upstream dropped everything.

    Returning 0.0 there would be a perfect score for a bench that measured
    nothing, which is the most dangerous possible failure mode for a gate.
    """
    with pytest.raises(ValueError, match="target and non-target"):
        compute_eer(target, nontarget)


def test_eer_is_scale_and_shift_invariant() -> None:
    """Cosine ranges differ per model; EER must depend on ordering only."""
    rng = np.random.default_rng(3)
    target = rng.normal(loc=1.5, size=20_000)
    nontarget = rng.normal(loc=0.0, size=20_000)

    plain = compute_eer(target, nontarget)
    rescaled = compute_eer(target * 3.0 + 10.0, nontarget * 3.0 + 10.0)

    assert rescaled.eer == pytest.approx(plain.eer, abs=1e-9)


# --- trial lists ----------------------------------------------------------


def test_parse_trial_line_reads_both_labels() -> None:
    assert parse_trial_line("1 a/1.wav a/2.wav") == Trial(True, "a/1.wav", "a/2.wav")
    assert parse_trial_line("0 a/1.wav b/1.wav") == Trial(False, "a/1.wav", "b/1.wav")


@pytest.mark.parametrize("line", ["", "   ", "\n", "# comment"])
def test_parse_trial_line_skips_blanks_and_comments(line: str) -> None:
    assert parse_trial_line(line) is None


@pytest.mark.parametrize(
    "line",
    ["1 only-one-path.wav", "1 a.wav b.wav c.wav", "2 a.wav b.wav", "yes a.wav b.wav"],
)
def test_parse_trial_line_rejects_malformed_input(line: str) -> None:
    with pytest.raises(ValueError):
        parse_trial_line(line)


def test_load_trials_reports_the_offending_line_number(tmp_path) -> None:
    path = tmp_path / "trials.txt"
    path.write_text("1 a.wav b.wav\n0 c.wav d.wav\nbroken\n", encoding="utf-8")

    with pytest.raises(ValueError, match=r"trials\.txt:3"):
        load_trials(path)


def test_load_trials_refuses_an_empty_list(tmp_path) -> None:
    """An empty list yields an empty EER, which is a gate reading off nothing."""
    path = tmp_path / "empty.txt"
    path.write_text("# only a comment\n", encoding="utf-8")

    with pytest.raises(ValueError, match="no trials"):
        load_trials(path)


def test_split_scores_separates_by_ground_truth() -> None:
    trials = [Trial(True, "a", "b"), Trial(False, "a", "c"), Trial(True, "b", "b")]
    target, nontarget = split_scores(trials, [0.9, 0.2, 0.8])

    assert sorted(target.tolist()) == [0.8, 0.9]
    assert nontarget.tolist() == [0.2]


def test_iter_scored_refuses_a_length_mismatch() -> None:
    """zip() would truncate silently and shrink the EER for a dropped embedding."""
    with pytest.raises(ValueError, match="2 trials but 1 scores"):
        list(iter_scored([Trial(True, "a", "b"), Trial(False, "a", "c")], [0.5]))


# --- duration buckets -----------------------------------------------------


@pytest.mark.parametrize(
    "duration, expected",
    [
        (0.4, None),
        (0.5, None),
        (0.9, None),
        (1.0, 1.0),
        (1.9, 1.0),
        (2.0, 2.0),
        (2.7, 2.0),
        (3.0, 3.0),
        (9.0, 3.0),
    ],
)
def test_bucket_for_takes_the_largest_fillable_bucket(
    duration: float, expected: float | None
) -> None:
    assert bucket_for(duration) == expected


def test_bucket_never_exceeds_the_clip() -> None:
    """No clip may be assigned a bucket longer than itself.

    That would require padding, and padded silence scored as speech inflates
    every number derived from the cell.
    """
    for duration in np.arange(0.1, 6.0, 0.05):
        bucket = bucket_for(float(duration))
        assert bucket is None or bucket <= duration + 1e-9


def test_buckets_are_ordered_and_match_the_gate() -> None:
    assert DURATION_BUCKETS_S == (1.0, 2.0, 3.0)
    assert list(DURATION_BUCKETS_S) == sorted(DURATION_BUCKETS_S)


def test_truncate_to_takes_the_leading_window() -> None:
    samples = np.arange(16_000 * 3, dtype=np.float32)
    out = truncate_to(samples, 2.0, 16_000)

    assert len(out) == 32_000
    assert out[0] == 0 and out[-1] == 31_999


def test_truncate_to_refuses_to_pad() -> None:
    samples = np.zeros(16_000, dtype=np.float32)
    with pytest.raises(ValueError, match="padding would score silence"):
        truncate_to(samples, 2.0, 16_000)


def test_truncate_to_accepts_an_exact_fit() -> None:
    samples = np.zeros(32_000, dtype=np.float32)
    assert len(truncate_to(samples, 2.0, 16_000)) == 32_000


def test_bucket_and_truncate_agree() -> None:
    """Whatever bucket_for chooses must be truncatable without padding."""
    rate = 16_000
    for duration in (0.6, 1.0, 1.5, 2.0, 2.5, 3.0, 4.4):
        bucket = bucket_for(duration)
        if bucket is None:
            continue
        samples = np.zeros(int(duration * rate), dtype=np.float32)
        assert len(truncate_to(samples, bucket, rate)) == int(round(bucket * rate))


def test_analytic_reference_is_itself_sane() -> None:
    """Sanity-check the yardstick, so a scipy change cannot quietly move it."""
    assert float(norm.cdf(-0.0 / 2)) == pytest.approx(0.5)
    assert float(norm.cdf(-2.0 / 2)) == pytest.approx(0.158655, abs=1e-5)
    assert math.isclose(float(norm.cdf(-6.0 / 2)), 0.001349898, rel_tol=1e-6)
