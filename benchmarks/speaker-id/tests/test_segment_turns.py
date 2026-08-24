"""Tests for `segment()` — the layer the benches actually call.

The parity suite verifies `run_gate`, i.e. that the gate fires where the real
gate fires. It says nothing about what audio a turn then CONTAINS, and that is
where the pump's behaviour lives: held silence, pre-roll, and turns that never
close. All three were wrong before these tests existed.

Signals are synthesised rather than read from fixtures so the expected answer is
known exactly, and so these run on a machine with no fixtures and no toolchain.
"""

from __future__ import annotations

import numpy as np
import pytest

from speaker_bench.segment import (
    MIN_TRAILING_SILENCE_MS,
    PRE_ROLL_MS,
    SPEECH_HANGOVER_MS,
    WORKLET_BLOCK_SAMPLES,
    Segmentation,
    segment,
)

RATE = 48_000
BLOCK_MS = (WORKLET_BLOCK_SAMPLES // (RATE // 16_000)) / 16_000 * 1000


def _ms_to_samples(ms: float) -> int:
    return int(RATE * ms / 1000.0)


def speech(ms: float, *, level: float = 0.3, seed: int = 0) -> np.ndarray:
    """Noise loud enough to clear the gate's margin.

    Noise rather than a tone: a tone's RMS is stable, which would hide a bug in
    per-block level computation that a varying signal exposes.
    """
    rng = np.random.default_rng(seed)
    return rng.uniform(-level, level, _ms_to_samples(ms))


def silence(ms: float) -> np.ndarray:
    return np.zeros(_ms_to_samples(ms))


def build(*parts: np.ndarray) -> np.ndarray:
    return np.concatenate(parts)


def test_a_clip_that_ends_promptly_yields_no_turns_and_says_so() -> None:
    """The defect that made 32 of 35 fixtures segment to nothing.

    Dropping an unterminated turn is correct — production never sent it. Doing so
    silently is not: an empty list reads identically to "no speech here", and a
    bench would report a verdict about a measurement that never ran.
    """
    result = segment(build(silence(300), speech(1500)), RATE)

    assert isinstance(result, Segmentation)
    assert result.turns == []
    assert result.dropped_open_turns == 1

    with pytest.raises(ValueError, match="never closed"):
        result.require_terminated("prompt-ending clip")


def test_enough_trailing_silence_closes_the_turn() -> None:
    result = segment(
        build(silence(300), speech(1500), silence(MIN_TRAILING_SILENCE_MS)), RATE
    )

    assert result.dropped_open_turns == 0
    turns = result.require_terminated()
    assert len(turns) == 1
    assert turns[0].reason == "hangover"


def test_turn_audio_stops_before_the_hangover_tail() -> None:
    """`closeTurn` drops held silence, so the turn must not carry it.

    Production holds silent blocks, flushes them at `onProbableEnd`, and drops
    whatever is still held when the turn closes. A turn that carried the full
    hangover would hand the embedder ~350ms of room tone production never sends —
    a systematic distortion, worst in the shortest duration bucket, which is the
    bucket Checkpoint 1 is decided at.
    """
    trailing = 900.0
    result = segment(build(silence(300), speech(1200), silence(trailing)), RATE)
    turn = result.require_terminated()[0]

    speech_ends_at = 300 + 1200
    # The turn keeps the PROBABLE_END_MS of silence that was flushed, and nothing
    # after it — never the whole hangover.
    assert turn.end_ms < speech_ends_at + SPEECH_HANGOVER_MS, (
        f"turn carries the hangover tail: ends at {turn.end_ms:.0f}ms, "
        f"speech ended ~{speech_ends_at}ms"
    )
    assert turn.end_ms > speech_ends_at - 3 * BLOCK_MS, (
        f"turn ends before the speech does: {turn.end_ms:.0f}ms"
    )


def test_pre_roll_never_reaches_into_the_previous_turn() -> None:
    """`closeTurn` clears pre-roll, so turns cannot overlap.

    Without the clamp, a speaker starting within PRE_ROLL_MS of the previous turn
    closing gets up to 320ms of the PREVIOUS speaker's audio prepended to their
    embedding window — on a 1s turn, ~30% of the window from the wrong person.
    """
    gap = 620.0  # just past the hangover, so turn 2 opens soon after turn 1 closes
    result = segment(
        build(
            silence(300),
            speech(900, seed=1),
            silence(gap),
            speech(900, seed=2),
            silence(MIN_TRAILING_SILENCE_MS),
        ),
        RATE,
    )
    turns = result.require_terminated()
    assert len(turns) == 2, f"expected two turns, got {len(turns)}"

    first, second = turns
    assert second.start_ms >= first.end_ms, (
        f"turns overlap: second starts at {second.start_ms:.0f}ms, "
        f"first's audio ends at {first.end_ms:.0f}ms"
    )
    assert second.start_block >= first.end_block, (
        f"pre-roll reached back past the close: second starts at block "
        f"{second.start_block}, first ended at block {first.end_block}"
    )


def test_pre_roll_is_kept_when_there_is_room_for_it() -> None:
    """The clamp must not destroy pre-roll it was never meant to touch.

    A guard that always pinned the start to the speech onset would pass the
    overlap test above while silently discarding the first syllable of every
    turn, which is the whole reason pre-roll exists.
    """
    lead = 2000.0
    result = segment(build(silence(lead), speech(900), silence(MIN_TRAILING_SILENCE_MS)), RATE)
    turn = result.require_terminated()[0]

    # The gate needs MIN_SPEECH_MS before it opens, so the turn opens a little
    # after the speech starts; pre-roll should pull the start back before it.
    assert turn.start_ms < lead, (
        f"pre-roll was dropped: turn starts at {turn.start_ms:.0f}ms, "
        f"speech starts at {lead}ms"
    )
    assert turn.start_ms >= lead - PRE_ROLL_MS - 2 * BLOCK_MS, (
        f"pre-roll reached further back than PRE_ROLL_MS: {turn.start_ms:.0f}ms"
    )


def test_net_speech_excludes_pre_roll_and_the_dropped_tail() -> None:
    """The short-turn ladder gates on net speech, so it must count only speech."""
    result = segment(
        build(silence(1000), speech(800), silence(MIN_TRAILING_SILENCE_MS)), RATE
    )
    turn = result.require_terminated()[0]

    assert turn.net_speech_ms <= 800 + 2 * BLOCK_MS, (
        f"net speech {turn.net_speech_ms:.0f}ms exceeds the 800ms of actual speech"
    )
    assert turn.net_speech_ms > 600, (
        f"net speech {turn.net_speech_ms:.0f}ms is far below the 800ms spoken"
    )
    assert turn.net_speech_ms < turn.wall_ms, "net speech should be less than wall time"


def test_internal_pause_stays_inside_one_turn() -> None:
    """A pause shorter than the hangover is not a turn boundary."""
    result = segment(
        build(
            silence(300),
            speech(700, seed=3),
            silence(SPEECH_HANGOVER_MS - 200),
            speech(700, seed=4),
            silence(MIN_TRAILING_SILENCE_MS),
        ),
        RATE,
    )
    turns = result.require_terminated()
    assert len(turns) == 1, f"an internal pause split the turn: {len(turns)} turns"
    # Both speech runs counted; the pause between them did not.
    turn_net = turns[0].net_speech_ms
    assert 1100 < turn_net < 1500, f"net speech {turn_net:.0f}ms outside the expected ~1400ms"


def test_duration_buckets_follow_net_speech() -> None:
    cases = [(600, "sub1s"), (1500, "1s"), (2500, "2s"), (3500, "3s")]
    for spoken_ms, expected in cases:
        result = segment(
            build(silence(300), speech(spoken_ms), silence(MIN_TRAILING_SILENCE_MS)), RATE
        )
        turn = result.require_terminated()[0]
        assert turn.duration_bucket == expected, (
            f"{spoken_ms}ms of speech gave net {turn.net_speech_ms:.0f}ms "
            f"-> bucket {turn.duration_bucket}, expected {expected}"
        )


def test_forced_cut_produces_multiple_turns_without_overlap() -> None:
    """The ceiling path must respect the same audio boundaries."""
    result = segment(
        build(silence(300), speech(5000), silence(MIN_TRAILING_SILENCE_MS)),
        RATE,
        max_utterance_ms=1500,
    )
    turns = result.require_terminated()
    assert len(turns) >= 2, f"a 1500ms ceiling on 5s of speech gave {len(turns)} turns"
    assert any(t.reason == "forced" for t in turns), "no forced cut recorded"

    for earlier, later in zip(turns, turns[1:]):
        assert later.start_block >= earlier.end_block, (
            f"forced-cut turns overlap: {later.start_block} < {earlier.end_block}"
        )
