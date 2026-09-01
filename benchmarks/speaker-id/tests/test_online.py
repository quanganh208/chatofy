"""Tests for online attribution.

The failure modes here are quiet ones. A centroid that folds in dead-zone turns
still produces labels, just steadily worse ones; a scorer that credits two
clusters to one speaker still produces an accuracy, just an inflated one. Each
test below targets one such lie rather than checking that the code runs.
"""

from __future__ import annotations

import numpy as np
import pytest

from speaker_bench.online import (
    Assignment,
    OnlineAttributor,
    score_session,
)


def unit(*values: float) -> np.ndarray:
    vector = np.asarray(values, dtype=np.float32)
    return vector / np.linalg.norm(vector)


A = unit(1, 0, 0)
B = unit(0, 1, 0)
NEAR_A = unit(0.99, 0.14, 0)  # cosine ~0.99 with A


# --- the dead zone ---------------------------------------------------------


def test_thresholds_must_not_invert() -> None:
    """tau_new above tau_assign would make one turn both join and split."""
    with pytest.raises(ValueError, match="inverts the dead zone"):
        OnlineAttributor(tau_assign=0.3, tau_new=0.6)


def test_equal_thresholds_are_allowed_and_remove_the_dead_zone() -> None:
    """A degenerate but legitimate configuration: every turn gets a label."""
    attributor = OnlineAttributor(tau_assign=0.5, tau_new=0.5)
    attributor.observe(A)
    assert not attributor.observe(B).undecided


def test_a_turn_in_the_dead_zone_is_left_undecided() -> None:
    attributor = OnlineAttributor(tau_assign=0.9, tau_new=0.2)
    attributor.observe(A)
    middle = unit(1, 1, 0)  # cosine ~0.707 with A: between the thresholds

    assignment = attributor.observe(middle)
    assert assignment.undecided
    assert assignment.created is False
    assert attributor.speakers == 1


def test_an_undecided_turn_never_touches_the_centroid() -> None:
    """The property the dead zone exists for.

    Folding an uncertain turn into a centroid corrupts every later decision that
    centroid takes part in, and nothing in the output would show it.
    """
    attributor = OnlineAttributor(tau_assign=0.9, tau_new=0.2)
    attributor.observe(A)
    before = attributor.centroids[0].copy()

    attributor.observe(unit(1, 1, 0))

    np.testing.assert_array_equal(attributor.centroids[0], before)


# --- discovering speakers --------------------------------------------------


def test_the_first_turn_always_creates_a_speaker() -> None:
    attributor = OnlineAttributor(tau_assign=0.9, tau_new=0.2)
    assignment = attributor.observe(A)

    assert assignment.created and assignment.label == 0
    assert assignment.score == -np.inf, "nothing to compare the first turn against"


def test_a_distant_turn_creates_a_new_speaker() -> None:
    attributor = OnlineAttributor(tau_assign=0.9, tau_new=0.2)
    attributor.observe(A)

    assignment = attributor.observe(B)  # cosine 0 with A
    assert assignment.created and assignment.label == 1
    assert attributor.speakers == 2


def test_a_close_turn_joins_the_existing_speaker() -> None:
    attributor = OnlineAttributor(tau_assign=0.9, tau_new=0.2)
    attributor.observe(A)

    assignment = attributor.observe(NEAR_A)
    assert not assignment.created and assignment.label == 0
    assert attributor.speakers == 1


def test_a_turn_is_matched_against_the_best_centroid_not_the_first() -> None:
    attributor = OnlineAttributor(tau_assign=0.9, tau_new=0.2)
    attributor.observe(A)
    attributor.observe(B)

    assert attributor.observe(unit(0.02, 0.99, 0)).label == 1


# --- the centroid ----------------------------------------------------------


def test_the_centroid_moves_toward_assigned_turns() -> None:
    attributor = OnlineAttributor(tau_assign=0.5, tau_new=0.0)
    attributor.observe(A)
    attributor.observe(unit(1, 1, 0))

    centroid = attributor.centroids[0]
    assert centroid[1] > 0, "an assigned turn left the centroid unchanged"
    assert float(centroid @ A) < 1.0


def test_the_centroid_stays_unit_length() -> None:
    """Every consumer treats cosine as a dot product; drift would break that."""
    attributor = OnlineAttributor(tau_assign=0.5, tau_new=0.0)
    attributor.observe(A)
    for _ in range(5):
        attributor.observe(unit(1, 0.3, 0))

    assert float(np.linalg.norm(attributor.centroids[0])) == pytest.approx(1.0, abs=1e-6)


def test_the_centroid_cap_stops_further_folding() -> None:
    capped = OnlineAttributor(tau_assign=0.5, tau_new=0.0, centroid_cap=2)
    uncapped = OnlineAttributor(tau_assign=0.5, tau_new=0.0)
    for attributor in (capped, uncapped):
        attributor.observe(A)
        for _ in range(6):
            attributor.observe(unit(1, 0.5, 0))

    assert float(capped.centroids[0] @ A) > float(uncapped.centroids[0] @ A), (
        "the cap must limit how far later turns can drag a centroid"
    )


def test_an_uncapped_centroid_keeps_absorbing() -> None:
    attributor = OnlineAttributor(tau_assign=0.5, tau_new=0.0)
    attributor.observe(A)
    attributor.observe(unit(1, 0.5, 0))
    after_one = float(attributor.centroids[0] @ A)
    for _ in range(5):
        attributor.observe(unit(1, 0.5, 0))

    assert float(attributor.centroids[0] @ A) < after_one


def test_seeding_registers_a_speaker_without_consuming_a_turn() -> None:
    """The optional-enrolment path: known speakers exist before anyone speaks."""
    attributor = OnlineAttributor(tau_assign=0.9, tau_new=0.2)
    attributor.seed(A)
    attributor.seed(B)

    assignment = attributor.observe(NEAR_A)
    assert attributor.speakers == 2, "a seeded meeting must not invent a third speaker"
    assert assignment.label == 0 and not assignment.created


def test_seeding_changes_the_first_turn_from_a_guess_to_a_decision() -> None:
    """Cold start's actual cost, isolated.

    Unseeded, the first turn creates a cluster whatever it is — the attributor
    has no basis for any other answer. Seeded, that same turn is matched.
    """
    cold = OnlineAttributor(tau_assign=0.9, tau_new=0.2)
    warm = OnlineAttributor(tau_assign=0.9, tau_new=0.2)
    warm.seed(A)

    assert cold.observe(NEAR_A).created is True
    assert warm.observe(NEAR_A).created is False


# --- scoring ---------------------------------------------------------------


def _assign(labels: list[int | None]) -> list[Assignment]:
    return [Assignment(label=label, created=False, score=0.0) for label in labels]


def test_cluster_ids_are_arbitrary_so_a_permutation_scores_perfectly() -> None:
    truth = ["ann", "ann", "bo", "bo"]
    score = score_session(truth, _assign([7, 7, 3, 3]))

    assert score.accuracy == 1.0
    assert score.coverage == 1.0
    assert score.speaker_count_error == 0


def test_undecided_turns_cost_coverage_not_accuracy() -> None:
    truth = ["ann", "ann", "bo", "bo"]
    score = score_session(truth, _assign([0, None, 1, 1]))

    assert score.coverage == 0.75
    assert score.accuracy == 1.0, "an unlabelled turn is not a wrong label"


def test_splitting_one_speaker_across_two_clusters_is_penalised() -> None:
    """One person shown under two names is a real product failure.

    A majority-vote scorer would credit both clusters to that speaker and report
    100%. The one-to-one assignment must refuse to.
    """
    truth = ["ann"] * 4
    score = score_session(truth, _assign([0, 0, 1, 1]))

    assert score.accuracy == 0.5
    assert score.speaker_count_error == 1


def test_merging_two_speakers_into_one_cluster_is_penalised() -> None:
    truth = ["ann", "ann", "bo", "bo"]
    score = score_session(truth, _assign([0, 0, 0, 0]))

    assert score.accuracy == 0.5
    assert score.speaker_count_error == -1


def test_a_session_with_nothing_attributed_scores_zero_rather_than_dividing() -> None:
    score = score_session(["ann", "bo"], _assign([None, None]))

    assert score.coverage == 0.0 and score.accuracy == 0.0
    assert score.clusters == 0


def test_scoring_refuses_a_length_mismatch() -> None:
    """Silently zipping to the shorter list would drop turns from the denominator."""
    with pytest.raises(ValueError, match="turns but"):
        score_session(["ann", "bo"], _assign([0]))


def test_accuracy_is_over_attributed_turns_only() -> None:
    truth = ["ann", "ann", "bo", "bo"]
    # One wrong label, one undecided.
    score = score_session(truth, _assign([0, 1, 1, None]))

    assert score.attributed == 3
    assert score.accuracy == pytest.approx(2 / 3)


# --- the bounded-speaker arm -----------------------------------------------

C = unit(0, 0, 1)


def test_defaults_are_the_unbounded_attributor_the_numbers_were_measured_on() -> None:
    """The regression guard for every published cold number.

    Each parameter below was added for an arm that does not ship yet. If any of
    them changed behaviour at its default, every figure in `results/` would
    silently start describing a different algorithm than the one that produced
    it.
    """
    attributor = OnlineAttributor(tau_assign=0.9, tau_new=0.2)

    assert attributor.k_max is None
    assert attributor.centroid_cap is None and attributor.centroid_window is None
    assert attributor.mint_confirmations == 1

    assert attributor.observe(A).created is True
    assert attributor.observe(B).created is True
    assert attributor.observe(NEAR_A).label == 0
    assert attributor.observe(unit(1, 1, 0)).undecided
    assert attributor.speakers == 2


def test_k_max_blocks_creation() -> None:
    attributor = OnlineAttributor(tau_assign=0.9, tau_new=0.2, k_max=2)
    attributor.observe(A)
    attributor.observe(B)

    attributor.observe(C)  # orthogonal to both: would have been speaker 3
    assert attributor.speakers == 2


def test_above_the_cap_the_default_policy_steals_rather_than_abstaining() -> None:
    """The correction the plan turns on.

    `k_max` guards `_create` only, and the assign branch runs first, so a capped
    attributor does not fall silent on an unmodelled speaker — it puts that
    turn under somebody else's ordinal. Measured at a 64.9% theft rate. This
    test exists so nobody can claim abstention the code does not deliver.
    """
    attributor = OnlineAttributor(tau_assign=0.9, tau_new=0.2, k_max=2, above_cap="assign")
    attributor.observe(A)
    attributor.observe(B)

    assignment = attributor.observe(C)
    assert assignment.label is not None, "the cap silenced a turn it cannot silence"
    assert assignment.created is False
    assert attributor.speakers == 2


def test_the_abstain_policy_is_the_one_that_actually_falls_silent() -> None:
    attributor = OnlineAttributor(tau_assign=0.9, tau_new=0.2, k_max=2, above_cap="abstain")
    attributor.observe(A)
    attributor.observe(B)

    assert attributor.observe(C).undecided
    assert attributor.speakers == 2


def test_raising_tau_above_the_cap_narrows_which_turns_still_get_a_label() -> None:
    """Policy C: keep assigning, but only on strong matches."""
    lenient = OnlineAttributor(tau_assign=0.5, tau_new=0.2, k_max=1)
    strict = OnlineAttributor(
        tau_assign=0.5, tau_new=0.2, k_max=1, above_cap="raise_tau", tau_assign_capped=0.95
    )
    middling = unit(1, 0.9, 0)  # cosine ~0.74 with A

    for attributor in (lenient, strict):
        attributor.observe(A)

    assert lenient.observe(middling).label == 0
    assert strict.observe(middling).undecided


def test_the_raised_bar_must_be_supplied_and_must_actually_be_higher() -> None:
    with pytest.raises(ValueError, match="needs tau_assign_capped"):
        OnlineAttributor(tau_assign=0.5, tau_new=0.2, k_max=2, above_cap="raise_tau")
    with pytest.raises(ValueError, match="would LOOSEN"):
        OnlineAttributor(
            tau_assign=0.5, tau_new=0.2, k_max=2,
            above_cap="raise_tau", tau_assign_capped=0.3,
        )


def test_an_unknown_above_cap_policy_is_refused() -> None:
    with pytest.raises(ValueError, match="not one of"):
        OnlineAttributor(tau_assign=0.5, tau_new=0.2, k_max=2, above_cap="silence")


def test_a_cap_below_one_speaker_is_refused() -> None:
    with pytest.raises(ValueError, match="at least one speaker"):
        OnlineAttributor(tau_assign=0.5, tau_new=0.2, k_max=0)


def test_seeding_ignores_the_cap() -> None:
    """A caller naming known speakers has better information than any cap."""
    attributor = OnlineAttributor(tau_assign=0.9, tau_new=0.2, k_max=1)
    attributor.seed(A)
    attributor.seed(B)

    assert attributor.speakers == 2


def test_the_cap_reports_when_it_has_bound() -> None:
    attributor = OnlineAttributor(tau_assign=0.9, tau_new=0.2, k_max=2)
    attributor.observe(A)
    assert not attributor.cap_bound
    attributor.observe(B)
    assert attributor.cap_bound


# --- deferred mint ---------------------------------------------------------


def test_a_deferred_mint_renders_nothing_until_it_is_corroborated() -> None:
    attributor = OnlineAttributor(tau_assign=0.9, tau_new=0.2, mint_confirmations=2)

    first = attributor.observe(A)
    assert first.undecided, "an unconfirmed speaker must carry no ordinal"
    assert attributor.speakers == 0 and attributor.provisional == 1

    second = attributor.observe(NEAR_A)  # corroborates the first cluster
    assert second.created and second.label == 0
    assert attributor.speakers == 1 and attributor.provisional == 0


def test_one_confirmation_means_no_deferral_at_all() -> None:
    attributor = OnlineAttributor(tau_assign=0.9, tau_new=0.2, mint_confirmations=1)
    attributor.observe(A)

    assert attributor.observe(B).created is True
    assert attributor.provisional == 0


def test_a_provisional_speaker_is_not_counted_as_a_speaker() -> None:
    """The count error is computed from `speakers`, and a provisional cluster
    shows the user nothing — counting it would report a chip that is not there."""
    attributor = OnlineAttributor(tau_assign=0.9, tau_new=0.2, mint_confirmations=3)
    attributor.observe(A)
    attributor.observe(B)

    assert attributor.speakers == 0 and attributor.provisional == 2


def test_a_confirmations_floor_below_one_is_refused() -> None:
    with pytest.raises(ValueError, match="at least 1"):
        OnlineAttributor(tau_assign=0.5, tau_new=0.2, mint_confirmations=0)


# --- freezing versus tracking ----------------------------------------------


def test_the_cap_freezes_the_centroid_but_the_window_keeps_tracking() -> None:
    """The two are opposite behaviours, and only one matches the docstring.

    `centroid_cap` stops folding: the centroid is whatever the first `cap` turns
    made it, forever. A drifting voice never moves it again. `centroid_window`
    forgets instead, so the centroid follows the drift — which is what "the
    centroid keeps tracking" actually describes.
    """
    drift = unit(0, 1, 0)
    frozen = OnlineAttributor(tau_assign=0.0, tau_new=-1.0, centroid_cap=1)
    tracking = OnlineAttributor(tau_assign=0.0, tau_new=-1.0, centroid_window=1)
    for attributor in (frozen, tracking):
        attributor.observe(A)
        for _ in range(4):
            attributor.observe(drift)

    np.testing.assert_allclose(frozen.centroids[0], A, atol=1e-6)
    assert float(tracking.centroids[0] @ drift) > 0.99, "the window failed to forget"


def test_the_window_wins_when_both_bounds_are_set() -> None:
    attributor = OnlineAttributor(
        tau_assign=0.0, tau_new=-1.0, centroid_cap=1, centroid_window=2
    )
    attributor.observe(A)
    attributor.observe(unit(0, 1, 0))

    assert float(attributor.centroids[0] @ A) < 0.99, "the cap froze a windowed centroid"
