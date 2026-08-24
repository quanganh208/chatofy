"""Tests for trial-pair construction.

The rules here exist because breaking them produces a flattering EER rather than
a visible failure, so each test targets one way the screen could quietly lie:
same-speaker pairs that share a recording, a bucket that includes clips shorter
than it claims, or three prolific speakers supplying most of the distribution.
"""

from __future__ import annotations

import random
from collections import Counter

import pytest

from speaker_bench.corpus import Utterance
from speaker_bench.pairs import (
    MAX_PAIRS_PER_SPEAKER,
    MIN_INDEX_GAP,
    build_trials,
    eligible_by_speaker,
    sample_nontarget_pairs,
    sample_target_pairs,
)


def _utterance(speaker: str, order: int, duration: float = 5.0) -> Utterance:
    return Utterance(speaker=speaker, shard=0, row=order, order=order, duration_s=duration)


def _index(spec: dict[str, list[int]], duration: float = 5.0) -> list[Utterance]:
    """Build an index from {speaker: [orders]}."""
    return [
        _utterance(speaker, order, duration)
        for speaker, orders in spec.items()
        for order in orders
    ]


# --- the gap rule ---------------------------------------------------------


def test_target_pairs_all_satisfy_the_gap_rule() -> None:
    index = _index({"A": [0, 10, 200, 400], "B": [1, 300, 600]})
    by_speaker = eligible_by_speaker(index, 3.0)
    pairs = sample_target_pairs(by_speaker, 3.0, random.Random(0))

    assert pairs
    for pair in pairs:
        assert pair.index_gap >= MIN_INDEX_GAP, f"{pair.a.order} vs {pair.b.order}"


def test_a_speaker_whose_clips_are_all_adjacent_contributes_nothing() -> None:
    """The rule must exclude, not silently relax.

    A speaker whose every clip sits within the gap has no channel-independent
    pair to offer. Emitting one anyway is exactly the inflation the rule exists
    to prevent.
    """
    index = _index({"clustered": [0, 1, 2, 3], "spread": [100, 500, 900]})
    by_speaker = eligible_by_speaker(index, 3.0)
    pairs = sample_target_pairs(by_speaker, 3.0, random.Random(0))

    assert {pair.a.speaker for pair in pairs} == {"spread"}


def test_gap_rule_is_configurable_and_actually_applied() -> None:
    index = _index({"A": [0, 30, 60]})
    by_speaker = eligible_by_speaker(index, 3.0)

    loose = sample_target_pairs(by_speaker, 3.0, random.Random(0), min_index_gap=10)
    strict = sample_target_pairs(by_speaker, 3.0, random.Random(0), min_index_gap=50)

    assert len(loose) == 3  # (0,30) (0,60) (30,60)
    assert len(strict) == 1  # only (0,60)


def test_min_index_gap_matches_the_measured_plateau() -> None:
    """Guard the constant itself.

    The value was measured against its cost: the inflation is gone by 25 and the
    curve is flat after, while 100 would halve the speaker count for a further
    0.0013. Moving it silently would change what the gate describes.
    """
    assert MIN_INDEX_GAP == 25


# --- duration eligibility -------------------------------------------------


def test_clips_shorter_than_the_bucket_are_excluded() -> None:
    """A bucket must not contain audio shorter than the bucket.

    Including a 1.2s clip in the 3s bucket would require padding, and padded
    silence scored as speech inflates the cell.
    """
    index = [
        _utterance("A", 0, duration=1.2),
        _utterance("A", 100, duration=5.0),
        _utterance("A", 200, duration=4.0),
    ]
    by_speaker = eligible_by_speaker(index, 3.0)

    assert set(by_speaker) == {"A"}
    assert [u.order for u in by_speaker["A"]] == [100, 200]


def test_a_speaker_with_one_long_clip_cannot_form_a_target_pair() -> None:
    index = [_utterance("A", 0, 5.0), _utterance("A", 100, 1.0), _utterance("B", 200, 5.0)]
    assert eligible_by_speaker(index, 3.0) == {}


def test_longer_bucket_is_a_subset_of_the_shorter_one() -> None:
    """Eligibility must be monotone in bucket length."""
    index = _index({"A": [0, 100, 200]}, duration=2.5) + [_utterance("A", 300, 4.0)]
    short = eligible_by_speaker(index, 2.0)
    long = eligible_by_speaker(index, 3.0)

    assert set(long) <= set(short)


# --- the per-speaker cap --------------------------------------------------


def test_no_speaker_exceeds_the_pair_cap() -> None:
    """One speaker holds up to 2,559 clips against a median of 8.

    Without the cap that speaker supplies most of the target distribution and
    the EER describes them rather than the corpus.
    """
    prolific = list(range(0, 4000, 40))  # 100 clips, all far enough apart
    index = _index({"loud": prolific, "quiet": [5000, 5100]})
    by_speaker = eligible_by_speaker(index, 3.0)
    pairs = sample_target_pairs(by_speaker, 3.0, random.Random(1))

    counts = Counter(pair.a.speaker for pair in pairs)
    assert counts["loud"] <= MAX_PAIRS_PER_SPEAKER
    assert counts["quiet"] >= 1


def test_cap_is_offered_to_every_speaker_equally() -> None:
    spec = {name: list(range(index * 10_000, index * 10_000 + 400, 50)) for index, name in
            enumerate(["A", "B", "C"])}
    by_speaker = eligible_by_speaker(_index(spec), 3.0)
    pairs = sample_target_pairs(by_speaker, 3.0, random.Random(2), max_per_speaker=5)

    counts = Counter(pair.a.speaker for pair in pairs)
    assert set(counts) == {"A", "B", "C"}
    assert all(count == 5 for count in counts.values())


# --- non-target pairs -----------------------------------------------------


def test_nontarget_pairs_never_share_a_speaker() -> None:
    index = _index({"A": [0, 100], "B": [200, 300], "C": [400, 500]})
    by_speaker = eligible_by_speaker(index, 3.0)
    pairs = sample_nontarget_pairs(by_speaker, 3.0, random.Random(3), count=50)

    assert pairs
    for pair in pairs:
        assert pair.a.speaker != pair.b.speaker
        assert pair.same is False


def test_nontarget_sampling_terminates_with_one_speaker() -> None:
    """Must return empty rather than spin to its attempt limit."""
    by_speaker = eligible_by_speaker(_index({"A": [0, 100]}), 3.0)
    assert sample_nontarget_pairs(by_speaker, 3.0, random.Random(4), count=10) == []


# --- assembled trial lists ------------------------------------------------


def test_build_trials_reports_stats_that_can_condemn_its_own_result() -> None:
    """An EER without a speaker count cannot be told apart from one over three
    voices, so the stats are part of the contract, not decoration."""
    index = _index({"A": [0, 100], "B": [200, 300], "C": [400, 500]})
    pairs, stats = build_trials(index, 3.0, random.Random(5))

    assert stats["target_pairs"] > 0
    assert stats["nontarget_pairs"] > 0
    assert stats["speakers_contributing_targets"] <= stats["speakers_eligible"]
    assert stats["target_pairs"] == sum(1 for pair in pairs if pair.same)
    assert stats["nontarget_pairs"] == sum(1 for pair in pairs if not pair.same)


def test_build_trials_is_deterministic_for_a_seed() -> None:
    """The gate's number must be reproducible from the seed alone."""
    index = _index({"A": [0, 100, 200], "B": [300, 400], "C": [500, 700]})
    first, _ = build_trials(index, 3.0, random.Random(7))
    second, _ = build_trials(index, 3.0, random.Random(7))

    assert [(p.same, p.a.order, p.b.order) for p in first] == [
        (p.same, p.a.order, p.b.order) for p in second
    ]


def test_every_pair_carries_its_bucket() -> None:
    index = _index({"A": [0, 100], "B": [200, 300]})
    pairs, _ = build_trials(index, 2.0, random.Random(8))
    assert pairs and all(pair.bucket_s == 2.0 for pair in pairs)


@pytest.mark.parametrize("bucket", [1.0, 2.0, 3.0])
def test_trial_lists_are_balanced_across_buckets(bucket: float) -> None:
    index = _index({chr(65 + i): [i * 1000, i * 1000 + 100, i * 1000 + 300] for i in range(6)})
    pairs, stats = build_trials(index, bucket, random.Random(9))

    assert stats["target_pairs"] == stats["nontarget_pairs"], (
        "unbalanced sides make the two distributions' sampling noise differ, "
        "which jitters the threshold Phase 4 inherits"
    )
    assert len(pairs) == 2 * stats["target_pairs"]
