"""Tests for oracle-free scoring and signed count metrics.

Both modules under test exist because a number that looks right can be wrong in
a direction nobody checked: an accuracy that borrowed ground truth, and a count
error that threw away its sign. Each test below pins one of those directions.
"""

from __future__ import annotations

import numpy as np

from speaker_bench.online import Assignment, SessionScore, score_session
from speaker_bench.scoring import count_metrics, score_prefix_locked


def _turns(pairs: list[tuple[str, int | None, bool]]) -> tuple[list[str], list[Assignment]]:
    """(speaker, cluster label, created) triples -> truth and assignments."""
    truth = [name for name, _, _ in pairs]
    assignments = [
        Assignment(label=label, created=created, score=0.0) for _, label, created in pairs
    ]
    return truth, assignments


# --- the oracle ------------------------------------------------------------


def test_creation_order_scores_the_same_under_both_scorers() -> None:
    """When the greedy pass got it right, the oracle has nothing to add."""
    truth, assignments = _turns([
        ("ann", 0, True), ("bo", 1, True), ("ann", 0, False), ("bo", 1, False),
    ])

    assert score_session(truth, assignments).accuracy == 1.0
    assert score_prefix_locked(truth, assignments).accuracy == 1.0


def test_the_oracle_repairs_a_correspondence_the_product_could_not() -> None:
    """The gap this scorer exists to measure.

    Cluster 0 is created by ann, so prefix-locked reads it as ann forever. Most
    of its turns are bo's. The Hungarian scorer sees the whole table first and
    relabels it, recovering accuracy the live product has no way to recover.
    """
    truth, assignments = _turns([
        ("ann", 0, True), ("bo", 0, False), ("bo", 0, False), ("bo", 0, False),
    ])

    assert score_session(truth, assignments).accuracy == 0.75
    assert score_prefix_locked(truth, assignments).accuracy == 0.25


def test_prefix_locked_never_beats_the_oracle_on_an_over_split() -> None:
    """One-to-one is preserved, so a second cluster cannot re-claim a speaker.

    Without that rule an over-split would score BETTER without the oracle than
    with it, which would make the gap meaningless in exactly the regime the cold
    run fails.
    """
    truth, assignments = _turns([
        ("ann", 0, True), ("ann", 0, False), ("ann", 1, True), ("ann", 1, False),
    ])

    oracle = score_session(truth, assignments).accuracy
    locked = score_prefix_locked(truth, assignments).accuracy

    assert locked <= oracle
    assert locked == 0.5, "the surplus cluster earned credit it should not have"


def test_a_seeded_meeting_locks_its_correspondence_before_any_turn() -> None:
    """Warm mode: the centroids were named at seed time, so nothing is guessed."""
    truth, assignments = _turns([
        ("bo", 1, False), ("ann", 0, False), ("bo", 1, False),
    ])

    score = score_prefix_locked(truth, assignments, seeded=["ann", "bo"])
    assert score.accuracy == 1.0


def test_undecided_turns_cost_coverage_here_too() -> None:
    truth, assignments = _turns([
        ("ann", 0, True), ("ann", None, False), ("bo", 1, True), ("bo", 1, False),
    ])

    score = score_prefix_locked(truth, assignments)
    assert score.attributed == 3 and score.coverage == 0.75
    assert score.accuracy == 1.0


def test_prefix_locked_refuses_a_length_mismatch() -> None:
    truth, assignments = _turns([("ann", 0, True)])
    try:
        score_prefix_locked(truth + ["bo"], assignments)
    except ValueError as error:
        assert "turns but" in str(error)
    else:  # pragma: no cover - the assertion above is the test
        raise AssertionError("a length mismatch was scored instead of refused")


# --- the sign --------------------------------------------------------------


def _score(clusters: int, true_speakers: int) -> SessionScore:
    return SessionScore(
        attributed=10, total=10, correct=10, clusters=clusters, true_speakers=true_speakers
    )


def test_the_count_error_keeps_its_sign() -> None:
    assert _score(3, 2).speaker_count_error == 1, "over-split should read positive"
    assert _score(1, 2).speaker_count_error == -1, "a merge should read negative"


def test_over_split_and_merge_never_cancel_into_a_clean_report() -> None:
    """A mean of signed errors alone would report zero for a set that is wrong
    twice over, which is why the two rates are published beside it."""
    metrics = count_metrics([_score(3, 2), _score(1, 2)])

    assert metrics.signed_mean == 0.0
    assert metrics.exact_rate == 0.0
    assert metrics.over_split_rate == 0.5 and metrics.merge_rate == 0.5


def test_the_absolute_bar_is_degenerate_at_two_speakers_and_the_exact_rate_is_not() -> None:
    """The reason D6 replaces `|dN| <= 1.0` with an exact-count rate.

    A session that renders a two-person conversation as one person talking to
    themselves — the worst outcome the product has — scores |dN| = 1 and clears
    a cap of 1.0. No tightening of a bound that admits that fixes it.
    """
    collapsed = count_metrics([_score(1, 2)] * 4)

    assert collapsed.abs_mean <= 1.0, "the inherited bar passes a total merge"
    assert collapsed.exact_rate == 0.0, "the replacement bar must not"


def test_count_metrics_over_no_sessions_does_not_divide() -> None:
    metrics = count_metrics([])
    assert metrics.sessions == 0 and metrics.exact_rate == 0.0


def test_the_row_carries_both_the_signed_and_absolute_errors() -> None:
    """The absolute column stays so old and new runs remain comparable."""
    row = count_metrics([_score(3, 2)]).as_row()

    assert row["speaker_count_signed_error"] == "1.0000"
    assert row["speaker_count_abs_error"] == "1.0000"
    assert np.isclose(float(row["exact_count_rate"]), 0.0)
