"""Tests for the channel gate's verdict, its exit contract and its new outputs.

This gate reads a fixture that cannot be re-recorded. Every test here covers a
way the analysis could return a number, or a clean exit, that a reader would take
for a result:

* a verdict that collapses the three-way band into pass/fail;
* an exit code of 0 on a session that was never measured;
* a top-1 pass that lets a turn match itself through the moment next to it;
* a pooled delta that hides the one speaker the channel destroyed.
"""

from __future__ import annotations

import sys

import numpy as np
import pytest

from run_channel_delta import (
    DELTA_PASS_MAX,
    DELTA_STOP_MIN,
    EXIT_OK,
    EXIT_STOP,
    EXIT_UNMEASURED,
    MIN_LOO_PAIRS,
    leave_one_out_deltas,
    SHIPPING_MODEL,
    main,
    select_gate_rows,
    top1_accuracy,
    top1_matches,
    verdict_for,
)
from speaker_bench.channel import MIN_TURN_GAP, ChannelPair, Turn


def _turn(index: int, speaker: str) -> Turn:
    return Turn(
        turn_index=index,
        speaker_id=speaker,
        distance="0.5m",
        start_ms=index * 5000,
        end_ms=index * 5000 + 4000,
        language="vi",
    )


def _vector(*values: float) -> np.ndarray:
    """A unit vector, because `cosine` refuses anything else.

    That refusal is deliberate in `embed.py` — a non-unit argument silently
    scales every similarity — so a test fixture that skipped it would be
    exercising a call the real path cannot make.
    """
    vector = np.array(values, dtype=np.float32)
    return vector / np.linalg.norm(vector)


class TestTheBand:
    """The three-way band, which a binary constant used to flatten."""

    def test_a_small_delta_passes_and_exits_zero(self) -> None:
        name, code, _ = verdict_for(0.005)
        assert name == "PASS"
        assert code == EXIT_OK

    def test_the_pass_boundary_is_inclusive(self) -> None:
        assert verdict_for(DELTA_PASS_MAX)[0] == "PASS"

    def test_the_middle_of_the_band_proceeds_rather_than_passing_or_stopping(self) -> None:
        # The whole reason the band is three-way. A 4-point delta is neither
        # "the calibration stands" nor "stop the delivery", and a binary
        # constant had to call it one of those.
        name, code, _ = verdict_for(0.04)
        assert name == "PROCEED, BARS WIDEN"
        assert code == EXIT_OK

    def test_the_top_of_the_proceed_band_is_inclusive(self) -> None:
        # The plan reads "> +6.0 -> STOP", so exactly +6.0 is still PROCEED.
        # Reconciling script and plan at the boundary was step 1's stated job,
        # and this is the one value where the delivery either continues or ends.
        name, code, _ = verdict_for(DELTA_STOP_MIN)
        assert name == "PROCEED, BARS WIDEN"
        assert code == EXIT_OK

    def test_just_past_the_band_stops_the_delivery_and_exits_non_zero(self) -> None:
        name, code, _ = verdict_for(DELTA_STOP_MIN + 1e-6)
        assert name == "STOP"
        assert code == EXIT_STOP

    def test_a_large_delta_stops_the_delivery(self) -> None:
        assert verdict_for(0.2)[1] == EXIT_STOP

    def test_a_channel_that_helps_still_passes(self) -> None:
        # A negative delta means the processed track scored BETTER. Nothing about
        # that should trip a gate looking for damage.
        assert verdict_for(-0.02)[0] == "PASS"


class TestTheExitContract:
    """UNMEASURED is not a pass, and the script has to say so in its exit code."""

    def test_an_absent_fixture_exits_non_zero(self, tmp_path, monkeypatch) -> None:
        monkeypatch.setattr(
            sys, "argv", ["run_channel_delta.py", "--fixtures", str(tmp_path), "--session", "s1"]
        )
        assert main() == EXIT_UNMEASURED

    def test_a_gate_bucket_nothing_is_scored_at_exits_non_zero(self, tmp_path, monkeypatch) -> None:
        # Guards the specific accident this replaced: a gate bucket that no
        # longer matches any measured bucket used to fall back to the worst
        # bucket overall and print a verdict for it.
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "run_channel_delta.py",
                "--fixtures", str(tmp_path),
                "--gate-bucket", "5.0",
            ],
        )
        assert main() == EXIT_UNMEASURED


class TestGateRowSelection:
    """Which rows may deliver a verdict — the branch nothing used to reach."""

    def _row(self, model: str, bucket: float) -> dict:
        return {"model": model, "bucket_s": bucket, "worst_loo_delta": "0.01"}

    def test_the_gate_reads_the_shipping_model_at_the_gate_bucket(self) -> None:
        rows = [
            self._row(SHIPPING_MODEL, 1.0),
            self._row(SHIPPING_MODEL, 2.0),
            self._row("eres2netv2", 1.0),
        ]
        selected = select_gate_rows(rows, 1.0)
        assert selected == [self._row(SHIPPING_MODEL, 1.0)]

    def test_a_bucket_with_no_row_selects_nothing_rather_than_falling_back(self) -> None:
        # The post-session accident: turns come in shorter than expected, the
        # gate bucket ends up with no eligible pairs, and the old code silently
        # read the verdict off the worst OTHER bucket.
        rows = [self._row(SHIPPING_MODEL, 1.0), self._row(SHIPPING_MODEL, 2.0)]
        assert select_gate_rows(rows, 3.0) == []

    def test_a_model_that_is_not_shipped_cannot_deliver_a_verdict(self) -> None:
        # Phase 5 settled campplus. A STOP from a model the product does not use
        # would kill the delivery on a session that cannot be re-run.
        assert select_gate_rows([self._row("eres2netv2", 1.0)], 1.0) == []


class TestTopOne:
    """Nearest-neighbour identification, which is closer to what the product does."""

    def test_a_probe_matches_the_far_away_turn_of_its_own_speaker(self) -> None:
        turns = [_turn(0, "spk1"), _turn(1, "spk2"), _turn(10, "spk1")]
        vectors = {
            0: _vector(1.0, 0.0),
            1: _vector(0.0, 1.0),
            10: _vector(0.99, 0.14),
        }
        rows = {row["turn_index"]: row for row in top1_matches(turns, vectors)}
        assert rows[0]["nearest_turn_index"] == 10
        assert rows[0]["top1_correct"] == 1

    def test_the_gallery_excludes_both_speakers_inside_the_gap(self) -> None:
        # Turn 1 is adjacent to the probe and belongs to the OTHER speaker. If
        # the gap were applied to same-speaker candidates only, it would stay in
        # the gallery and the task would be harder on one side only.
        turns = [_turn(0, "spk1"), _turn(1, "spk2"), _turn(10, "spk1")]
        vectors = {
            0: _vector(1.0, 0.0),
            1: _vector(1.0, 0.001),  # nearest of all, but inside the gap
            10: _vector(0.9, 0.44),
        }
        rows = {row["turn_index"]: row for row in top1_matches(turns, vectors)}
        assert rows[0]["nearest_turn_index"] == 10

    def test_a_probe_with_no_reachable_same_speaker_turn_is_not_scored(self) -> None:
        # spk2 speaks once. There is no right answer to find, so counting it as
        # a miss would report the sheet's shape as a channel effect.
        turns = [_turn(0, "spk1"), _turn(1, "spk2"), _turn(10, "spk1")]
        vectors = {0: _vector(1.0, 0.0), 1: _vector(0.0, 1.0), 10: _vector(0.9, 0.44)}
        scored = {row["turn_index"] for row in top1_matches(turns, vectors)}
        assert scored == {0, 10}

    def test_an_adjacent_own_turn_alone_is_not_enough_to_be_scorable(self) -> None:
        turns = [_turn(0, "spk1"), _turn(1, "spk1"), _turn(20, "spk2"), _turn(30, "spk2")]
        vectors = {index: _vector(1.0, index / 100) for index in (0, 1, 20, 30)}
        scored = {row["turn_index"] for row in top1_matches(turns, vectors)}
        # spk1's two turns are one apart, inside MIN_TURN_GAP.
        assert MIN_TURN_GAP > 1
        assert scored == {20, 30}

    def test_accuracy_is_the_fraction_of_correct_probes(self) -> None:
        rows = [{"top1_correct": 1}, {"top1_correct": 0}, {"top1_correct": 1}, {"top1_correct": 1}]
        assert top1_accuracy(rows) == pytest.approx(0.75)

    def test_accuracy_of_nothing_is_not_a_number(self) -> None:
        # Never 0.0: an empty probe set means the fixture could not be scored,
        # and 0.0 would read as "the channel destroyed every match".
        assert np.isnan(top1_accuracy([]))

    def test_every_row_carries_the_labels_the_session_paid_to_collect(self) -> None:
        turns = [_turn(0, "spk1"), _turn(10, "spk1")]
        vectors = {0: _vector(1.0, 0.0), 10: _vector(0.9, 0.44)}
        row = top1_matches(turns, vectors)[0]
        assert row["language"] == "vi"
        assert row["distance"] == "0.5m"


class TestLeaveOneOut:
    """The spread the verdict actually gates on."""

    def _pairs(self, turns: dict[int, Turn]) -> list[ChannelPair]:
        indices = sorted(turns)
        return [
            ChannelPair(
                same=turns[a].speaker_id == turns[b].speaker_id,
                a=turns[a],
                b=turns[b],
                bucket_s=1.0,
            )
            for position, a in enumerate(indices)
            for b in indices[position + 1 :]
        ]

    def _many(self, speakers: int, per_speaker: int) -> dict[int, Turn]:
        return {
            speaker * 100 + n: _turn(speaker * 100 + n, f"spk{speaker + 1}")
            for speaker in range(speakers)
            for n in range(per_speaker)
        }

    def _vectors(self, turns: dict[int, Turn]) -> dict[str, dict[int, np.ndarray]]:
        return {
            "processed": {i: _vector(np.cos(i), np.sin(i)) for i in turns},
            "control": {i: _vector(np.cos(i / 2), np.sin(i / 2)) for i in turns},
        }

    def test_each_entry_is_named_by_the_speaker_left_out(self) -> None:
        turns = self._many(3, 25)
        spread = leave_one_out_deltas(
            self._pairs(turns), self._vectors(turns), ["spk1", "spk2", "spk3"]
        )
        assert set(spread) == {"spk1", "spk2", "spk3"}

    def test_each_entry_carries_the_pair_counts_it_was_scored_from(self) -> None:
        # Without these the reader cannot tell a delta measured over 1500 pairs
        # from one measured over 3, and the gate takes the MAX over them.
        turns = self._many(3, 25)
        spread = leave_one_out_deltas(
            self._pairs(turns), self._vectors(turns), ["spk1", "spk2", "spk3"]
        )
        delta, targets, nontargets = spread["spk1"]
        assert isinstance(delta, float)
        assert targets >= MIN_LOO_PAIRS and nontargets >= MIN_LOO_PAIRS

    def test_a_cell_below_the_pair_floor_is_dropped_rather_than_scored(self) -> None:
        # The failure this prevents: `_eer_over` returns a number from a single
        # pair, quantised to 0 or 1, and a spurious +1.0 in this dict is an
        # automatic STOP on a session nobody can record again.
        turns = self._many(3, 4)
        spread = leave_one_out_deltas(
            self._pairs(turns), self._vectors(turns), ["spk1", "spk2", "spk3"]
        )
        assert spread == {}

    def test_a_speaker_whose_removal_is_impossible_to_score_is_omitted(self) -> None:
        # Two speakers: removing either leaves no different-speaker pair at all,
        # so there is no EER to compute. Omitted rather than recorded as 0.0,
        # which would read as "this speaker contributes nothing".
        turns = self._many(2, 25)
        spread = leave_one_out_deltas(self._pairs(turns), self._vectors(turns), ["spk1", "spk2"])
        assert spread == {}
