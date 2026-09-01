"""Tests for the duration control's two load-bearing decisions.

The control's whole value is that it varies exactly one thing. Two ways it could
quietly stop doing that, and one way it could quietly decide something it is not
allowed to decide:

* the noise draw could differ between the arms for a reason other than duration;
* the arms could be scored over different pairs;
* the verdict could collapse the undetermined band into one of its neighbours,
  which is precisely the escalation the pre-registration exists to force.
"""

from __future__ import annotations

import random

import pytest

from run_duration_control import (
    RATIO_SOUND,
    RATIO_SUSPECT,
    _noise_rng,
    read_verdict,
)
from speaker_bench.corpus import Utterance
from speaker_bench.pairs import build_trials


# --- the verdict bands ----------------------------------------------------


@pytest.mark.parametrize(
    ("ratio", "expected"),
    [
        (4.0, "SOUND"),
        (RATIO_SOUND, "SOUND"),
        (1.6, "UNDETERMINED"),
        (RATIO_SUSPECT, "SUSPECT"),
        (1.0, "SUSPECT"),
        (0.8, "SUSPECT"),
    ],
)
def test_verdict_bands_are_closed_at_both_bars(ratio: float, expected: str) -> None:
    assert read_verdict(ratio) == expected


def test_undetermined_band_is_not_empty() -> None:
    """The escalation branch must be reachable.

    A rule whose middle band cannot fire is a two-outcome rule wearing three
    labels, which is the defect this measurement's first draft had.
    """
    midpoint = (RATIO_SUSPECT + RATIO_SOUND) / 2
    assert read_verdict(midpoint) == "UNDETERMINED"


# --- the noise draw -------------------------------------------------------


def test_noise_differs_between_durations_only_by_duration() -> None:
    """Same clip, two arms: independent draws, and neither depends on run order."""
    long_arm = _noise_rng(1, 42, 8.0).normal(size=8)
    short_arm = _noise_rng(1, 42, 1.0).normal(size=8)
    assert not (long_arm == short_arm).all()
    assert (long_arm == _noise_rng(1, 42, 8.0).normal(size=8)).all()


def test_noise_is_independent_of_how_many_clips_came_before() -> None:
    """The reason a per-clip generator exists at all.

    A single sequential generator would hand a clip whichever draw its position
    in the scan happened to reach, and the two arms do not share that position.
    """
    assert (_noise_rng(1, 7, 8.0).normal(size=4) == _noise_rng(1, 7, 8.0).normal(size=4)).all()
    assert not (
        _noise_rng(1, 7, 8.0).normal(size=4) == _noise_rng(1, 8, 8.0).normal(size=4)
    ).all()


# --- the shared population ------------------------------------------------


def test_every_clip_in_the_population_survives_both_truncations() -> None:
    """The invariant that lets one pair list serve both arms.

    Trials are built at the long bucket, so every clip is at least that long and
    can be cut to either arm without padding. If this ever stopped holding, the
    short arm would silently drop pairs and the comparison would be across two
    populations again — the exact confound the control was built to remove.
    """
    index = [
        Utterance(speaker=speaker, shard=0, row=order, order=order, duration_s=duration)
        for speaker, orders, duration in (
            ("a", (0, 100, 200), 9.0),
            ("b", (10, 110, 210), 8.5),
            ("c", (20, 120, 220), 8.0),
        )
        for order in orders
    ]
    pairs, stats = build_trials(index, 8.0, random.Random(0))

    assert stats["speakers_contributing_targets"] == 3
    for pair in pairs:
        assert pair.a.duration_s >= 8.0
        assert pair.b.duration_s >= 8.0
