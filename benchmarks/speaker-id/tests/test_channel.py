"""Tests for the browser-channel turn log.

The fixture this parses is expensive — it needs several people in a room — so a
log that is subtly wrong must fail loudly rather than produce a delta. Each test
below is one way the recording could be broken in a way that still yields a
number: a control track that was never raw, a log written against a different
take, turns that overlap so one clip holds two voices.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from speaker_bench.channel import (
    MIN_TURN_GAP,
    SAMPLE_RATE,
    Turn,
    build_channel_pairs,
    eligible_turns,
    load_turn_log,
    turn_samples,
)


def _turn(index: int, speaker: str, start_ms: int, duration_ms: int = 4000) -> dict:
    return {
        "turnIndex": index,
        "speakerId": speaker,
        "distance": "2m",
        "startMs": start_ms,
        "endMs": start_ms + duration_ms,
    }


def _log(tmp_path: Path, turns: list[dict], **overrides) -> Path:
    payload = {
        "sessionId": "s1",
        "sampleRate": SAMPLE_RATE,
        "settingsReported": {
            "processed": {"noiseSuppression": True, "autoGainControl": True},
            "control": {"noiseSuppression": False, "autoGainControl": False},
        },
        "turns": turns,
    }
    payload.update(overrides)
    path = tmp_path / "s1-turns.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


# --- the log has to describe a usable recording ---------------------------


def test_a_well_formed_log_loads_in_turn_order(tmp_path: Path) -> None:
    path = _log(tmp_path, [_turn(1, "spk2", 6000), _turn(0, "spk1", 0)])
    _, turns = load_turn_log(path)

    assert [turn.turn_index for turn in turns] == [0, 1]
    assert turns[0].speaker_id == "spk1"
    assert turns[0].duration_s == pytest.approx(4.0)


def test_a_control_track_that_kept_its_processing_is_refused(tmp_path: Path) -> None:
    """The failure the whole phase exists to avoid.

    If the platform applied noise suppression below the browser, both tracks
    went through it and their difference is zero for a reason that has nothing
    to do with production's channel. Scoring it would report "no channel effect"
    with full confidence.
    """
    path = _log(
        tmp_path,
        [_turn(0, "spk1", 0)],
        settingsReported={
            "processed": {"noiseSuppression": True},
            "control": {"noiseSuppression": True},
        },
    )
    with pytest.raises(ValueError, match="control is not a control"):
        load_turn_log(path)


def test_tracks_recorded_the_wrong_way_round_are_refused(tmp_path: Path) -> None:
    path = _log(
        tmp_path,
        [_turn(0, "spk1", 0)],
        settingsReported={
            "processed": {"noiseSuppression": False},
            "control": {"noiseSuppression": True},
        },
    )
    with pytest.raises(ValueError, match="wrong way round"):
        load_turn_log(path)


def test_a_log_at_the_wrong_sample_rate_is_refused(tmp_path: Path) -> None:
    """44.1k means the page did not downsample, so the channel is not production's."""
    path = _log(tmp_path, [_turn(0, "spk1", 0)], sampleRate=44100)
    with pytest.raises(ValueError, match="44100 Hz"):
        load_turn_log(path)


def test_overlapping_turns_are_refused(tmp_path: Path) -> None:
    """Overlap means a turn's audio holds another speaker, so its label is wrong."""
    path = _log(tmp_path, [_turn(0, "spk1", 0, 5000), _turn(1, "spk2", 3000)])
    with pytest.raises(ValueError, match="overlap in time"):
        load_turn_log(path)


def test_touching_turns_are_allowed(tmp_path: Path) -> None:
    """Back-to-back is the normal case for a push-to-talk prompter."""
    path = _log(tmp_path, [_turn(0, "spk1", 0, 4000), _turn(1, "spk2", 4000)])
    _, turns = load_turn_log(path)
    assert len(turns) == 2


def test_a_turn_that_ends_before_it_starts_is_refused(tmp_path: Path) -> None:
    path = _log(tmp_path, [{**_turn(0, "spk1", 5000), "endMs": 4000}])
    with pytest.raises(ValueError, match="ends before it starts"):
        load_turn_log(path)


def test_an_empty_log_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="no turns"):
        load_turn_log(_log(tmp_path, []))


# --- cutting audio --------------------------------------------------------


def test_turn_samples_cuts_at_the_logged_offsets() -> None:
    audio = np.arange(SAMPLE_RATE * 10, dtype=np.float32)
    turn = Turn(0, "spk1", "2m", start_ms=1000, end_ms=3000)

    clip = turn_samples(audio, turn)
    assert len(clip) == SAMPLE_RATE * 2
    assert clip[0] == SAMPLE_RATE


def test_turn_samples_refuses_a_log_that_runs_past_the_audio() -> None:
    """A log from a different take would otherwise silently score short clips."""
    audio = np.zeros(SAMPLE_RATE, dtype=np.float32)
    turn = Turn(0, "spk1", "2m", start_ms=0, end_ms=5000)

    with pytest.raises(ValueError, match="different recordings"):
        turn_samples(audio, turn)


# --- pairing --------------------------------------------------------------


def _turns(spec: list[tuple[int, str]], duration_s: float = 4.0) -> list[Turn]:
    return [
        Turn(index, speaker, "2m", start_ms=index * 10_000,
             end_ms=index * 10_000 + int(duration_s * 1000))
        for index, speaker in spec
    ]


def test_same_speaker_pairs_respect_the_turn_gap() -> None:
    turns = _turns([(i, "spk1" if i % 2 == 0 else "spk2") for i in range(12)])
    pairs = build_channel_pairs(turns, 3.0)

    for pair in pairs:
        if pair.same:
            assert pair.turn_gap >= MIN_TURN_GAP


def test_adjacent_same_speaker_turns_are_excluded() -> None:
    turns = _turns([(0, "spk1"), (1, "spk1"), (2, "spk2")])
    pairs = build_channel_pairs(turns, 3.0)

    assert not [pair for pair in pairs if pair.same]


def test_different_speaker_pairs_need_no_gap() -> None:
    """They share no identity, so an adjacent pair inflates nothing."""
    turns = _turns([(0, "spk1"), (1, "spk2")])
    pairs = build_channel_pairs(turns, 3.0)

    assert [pair.same for pair in pairs] == [False]


def test_clips_shorter_than_the_bucket_are_excluded() -> None:
    short = Turn(0, "spk1", "2m", start_ms=0, end_ms=1200)
    long_a = Turn(5, "spk1", "2m", start_ms=10_000, end_ms=15_000)
    long_b = Turn(10, "spk1", "2m", start_ms=20_000, end_ms=25_000)

    assert eligible_turns([short, long_a, long_b], 3.0) == [long_a, long_b]
    pairs = build_channel_pairs([short, long_a, long_b], 3.0)
    assert all(0 not in (pair.a.turn_index, pair.b.turn_index) for pair in pairs)


def test_pairing_is_deterministic_so_the_delta_carries_no_seed() -> None:
    """Both tracks must be scored on identical trials or the subtraction lies."""
    turns = _turns([(i, f"spk{i % 3 + 1}") for i in range(15)])
    first = build_channel_pairs(turns, 2.0)
    second = build_channel_pairs(turns, 2.0)

    assert [(p.same, p.a.turn_index, p.b.turn_index) for p in first] == [
        (p.same, p.a.turn_index, p.b.turn_index) for p in second
    ]


def test_pairs_carry_their_bucket() -> None:
    turns = _turns([(i, f"spk{i % 2 + 1}") for i in range(10)])
    pairs = build_channel_pairs(turns, 2.0)
    assert pairs and all(pair.bucket_s == 2.0 for pair in pairs)
