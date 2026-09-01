"""Tests for the offline settle pass.

The settle pass can improve a transcript and damage it in the same run, and a
single quality number would hide that. These tests pin the two errors apart and
pin the bound that keeps the pass from inventing people.
"""

from __future__ import annotations

import numpy as np

from speaker_bench.settle import settle, settle_errors


def unit(*values: float) -> np.ndarray:
    vector = np.asarray(values, dtype=np.float32)
    return vector / np.linalg.norm(vector)


ANN = unit(1, 0, 0)
ANN_2 = unit(0.99, 0.14, 0)
BO = unit(0, 1, 0)
BO_2 = unit(0.02, 0.99, 0)


def test_two_well_separated_speakers_settle_into_two_clusters() -> None:
    labels = settle(np.stack([ANN, BO, ANN_2, BO_2]), threshold=0.5)

    assert len(set(labels)) == 2
    assert labels[0] == labels[2] and labels[1] == labels[3]


def test_labels_are_numbered_in_first_appearance_order() -> None:
    """The product's ordinals mean "who spoke first", so the settled labels must
    too — otherwise a settled transcript renumbers itself for no visible reason."""
    labels = settle(np.stack([BO, ANN, BO_2, ANN_2]), threshold=0.5)

    assert labels[0] == 0, "the first turn must be speaker 0 after settling"
    assert labels[1] == 1


def test_the_cap_cuts_the_tree_and_merges_the_closest_pair() -> None:
    """Above the cap, a settle merges rather than discards.

    Three speakers separate cleanly at this threshold; the cap forces one
    merge, and it must be the nearest pair. `cy` sits closer to bo (cosine
    0.60) than to ann (0.10), so bo is who absorbs them.
    """
    cy = unit(0.1, 0.6, 0.8)
    turns = np.stack([ANN, ANN_2, BO, BO_2, cy])

    assert len(set(settle(turns, threshold=0.7))) == 3, "the fixture must separate first"

    labels = settle(turns, threshold=0.7, k_max=2)
    assert len(set(labels)) == 2
    assert labels[4] == labels[2], "the cap merged the wrong pair"
    assert labels[0] != labels[2], "ann and bo must survive as separate speakers"


def test_the_cap_is_an_upper_bound_and_ties_can_collapse_below_it() -> None:
    """What `k_max` guarantees, stated exactly.

    It bounds the count from above and promises nothing from below. Mutually
    equidistant turns — every pair at cosine distance 1.0 — give the linkage no
    basis to prefer one cut over another, and scipy's `maxclust` resolves the
    tie by collapsing them all into one. That is a MERGE, the invisible
    direction, so it is pinned here rather than left to be discovered in a
    result. Real embeddings are not exactly tied; a degenerate cache could be.
    """
    labels = settle(np.stack([ANN, BO, unit(0, 0, 1)]), threshold=0.5, k_max=2)

    assert len(set(labels)) <= 2


def test_an_empty_or_single_turn_session_does_not_divide() -> None:
    assert settle(np.zeros((0, 3), dtype=np.float32), threshold=0.5) == []
    assert settle(np.stack([ANN]), threshold=0.5) == [0]


# --- the two errors, apart -------------------------------------------------


def test_a_perfect_clustering_reports_neither_error() -> None:
    errors = settle_errors(["ann", "bo", "ann", "bo"], [0, 1, 0, 1])

    assert errors.clean
    assert errors.split_extra == 0 and errors.merge_extra == 0


def test_one_person_under_two_ordinals_is_a_split_and_only_a_split() -> None:
    errors = settle_errors(["ann", "ann"], [0, 1])

    assert errors.split_extra == 1
    assert errors.merge_extra == 0, "a split must not be reported as a merge"


def test_two_people_under_one_ordinal_is_a_merge_and_only_a_merge() -> None:
    errors = settle_errors(["ann", "bo"], [0, 0])

    assert errors.merge_extra == 1
    assert errors.split_extra == 0


def test_a_split_and_a_merge_in_one_session_do_not_cancel() -> None:
    """The failure the count error cannot see.

    Three speakers: ann is split across two clusters, and bo and cy share a
    third. The cluster count equals the speaker count, so the signed count error
    is zero and the session looks clean. It is wrong twice.
    """
    errors = settle_errors(
        ["ann", "ann", "bo", "cy"],
        [0, 1, 2, 2],
    )

    assert errors.clusters == errors.true_speakers, "count error would read zero here"
    assert errors.split_extra == 1 and errors.merge_extra == 1
    assert not errors.clean


def test_settle_errors_refuses_a_length_mismatch() -> None:
    try:
        settle_errors(["ann", "bo"], [0])
    except ValueError as error:
        assert "turns but" in str(error)
    else:  # pragma: no cover - the assertion above is the test
        raise AssertionError("a length mismatch was scored instead of refused")
