"""`scripts/cut_placement.py`'s classification helpers, on synthetic input.

These never touch a real recording or `gate-reference.mjs` — that replay
happens once, deliberately, in the plan's step 2 baseline and step 4 re-run,
never inside a test suite. What belongs here is the arithmetic: does a cut
timestamp land inside a Scribe token, in a real gap, or at punctuation; does a
forced cut's utterance time cross the ceiling-vs-lookahead line.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from cut_placement import ForcedCut, ScribeToken, classify_cut, forced_cuts, summarize  # noqa: E402


def _token(text: str, start_ms: float, end_ms: float) -> ScribeToken:
    return ScribeToken(text=text, start_ms=start_ms, end_ms=end_ms)


class TestClassifyCut:
    def test_inside_a_token(self) -> None:
        tokens = [_token("nam", 1000.0, 1200.0)]
        assert classify_cut(1100.0, tokens) == "inside_token"

    def test_exactly_on_a_token_boundary_is_not_inside(self) -> None:
        # `start < cut < end` is strict: a cut landing exactly on a boundary
        # clips nothing of the token itself.
        tokens = [_token("nam", 1000.0, 1200.0), _token("nay", 1400.0, 1600.0)]
        assert classify_cut(1200.0, tokens) != "inside_token"

    def test_phrase_safe_on_a_real_gap(self) -> None:
        # 300ms between tokens, cut lands in the middle of it.
        tokens = [_token("nam", 1000.0, 1200.0), _token("nay", 1500.0, 1700.0)]
        assert classify_cut(1350.0, tokens) == "phrase_safe"

    def test_neither_on_a_short_gap_without_punctuation(self) -> None:
        # 80ms gap: too short to be a real pause, and the preceding token does
        # not end on punctuation.
        tokens = [_token("nam", 1000.0, 1200.0), _token("nay", 1280.0, 1450.0)]
        assert classify_cut(1240.0, tokens) == "neither"

    def test_phrase_safe_on_trailing_punctuation_despite_a_short_gap(self) -> None:
        # Scribe timestamps often abut across a comma; the phrase boundary is
        # real even though the gap alone would not qualify.
        tokens = [_token("rồi,", 1000.0, 1200.0), _token("thì", 1220.0, 1400.0)]
        assert classify_cut(1210.0, tokens) == "phrase_safe"

    def test_phrase_safe_before_the_first_token(self) -> None:
        tokens = [_token("nam", 1000.0, 1200.0)]
        assert classify_cut(500.0, tokens) == "phrase_safe"

    def test_phrase_safe_after_the_last_token(self) -> None:
        tokens = [_token("nam", 1000.0, 1200.0)]
        assert classify_cut(5000.0, tokens) == "phrase_safe"

    def test_no_tokens_at_all_is_phrase_safe(self) -> None:
        assert classify_cut(1000.0, []) == "phrase_safe"


class TestForcedCuts:
    """`forced_cuts` walks a `gate-reference.mjs`-shaped event list."""

    def test_ceiling_cut_at_the_wall_time_ceiling(self) -> None:
        # blockMs=20, maxUtteranceMs=8000: utterance ran the full 8000ms
        # (400 blocks) before it was cut, at or past max_utterance_ms - block_ms.
        gate_output = {
            "blockMs": 20.0,
            "maxUtteranceMs": 8000.0,
            "events": [
                {"type": "start", "blockIndex": 0},
                {"type": "end", "blockIndex": 399, "atMs": 8000.0, "reason": "forced"},
            ],
        }
        cuts = forced_cuts(gate_output, tokens=[])
        assert len(cuts) == 1
        assert cuts[0].turn_class == "ceiling"

    def test_lookahead_cut_well_short_of_the_ceiling(self) -> None:
        # Same ceiling, but the turn closes after only 100 blocks (2000ms) --
        # a rule inside the lookahead found a pause long before the ceiling.
        gate_output = {
            "blockMs": 20.0,
            "maxUtteranceMs": 8000.0,
            "events": [
                {"type": "start", "blockIndex": 0},
                {"type": "end", "blockIndex": 99, "atMs": 2000.0, "reason": "forced"},
            ],
        }
        cuts = forced_cuts(gate_output, tokens=[])
        assert len(cuts) == 1
        assert cuts[0].turn_class == "lookahead"

    def test_hangover_ends_are_not_forced_cuts(self) -> None:
        gate_output = {
            "blockMs": 20.0,
            "maxUtteranceMs": 8000.0,
            "events": [
                {"type": "start", "blockIndex": 0},
                {"type": "end", "blockIndex": 50, "atMs": 1020.0, "reason": "hangover"},
            ],
        }
        assert forced_cuts(gate_output, tokens=[]) == []

    def test_multiple_turns_each_classified_against_their_own_start(self) -> None:
        gate_output = {
            "blockMs": 20.0,
            "maxUtteranceMs": 8000.0,
            "events": [
                {"type": "start", "blockIndex": 0},
                {"type": "end", "blockIndex": 399, "atMs": 8000.0, "reason": "forced"},
                {"type": "start", "blockIndex": 401},
                {"type": "end", "blockIndex": 450, "atMs": 9020.0, "reason": "forced"},
            ],
        }
        cuts = forced_cuts(gate_output, tokens=[])
        assert [c.turn_class for c in cuts] == ["ceiling", "lookahead"]

    def test_content_class_comes_from_the_scribe_tokens_at_the_cut_time(self) -> None:
        tokens = [_token("giữa", 7990.0, 8100.0)]
        gate_output = {
            "blockMs": 20.0,
            "maxUtteranceMs": 8000.0,
            "events": [
                {"type": "start", "blockIndex": 0},
                {"type": "end", "blockIndex": 399, "atMs": 8000.0, "reason": "forced"},
            ],
        }
        cuts = forced_cuts(gate_output, tokens)
        assert cuts[0].content_class == "inside_token"


class TestSummarize:
    def test_counts_every_class(self) -> None:
        cuts = [
            ForcedCut(at_ms=100.0, block_index=5, turn_class="ceiling", content_class="inside_token"),
            ForcedCut(at_ms=200.0, block_index=10, turn_class="lookahead", content_class="phrase_safe"),
            ForcedCut(at_ms=300.0, block_index=15, turn_class="lookahead", content_class="neither"),
        ]
        counts = summarize(cuts)
        assert counts == {
            "forced": 3,
            "ceiling": 1,
            "lookahead": 2,
            "inside_token": 1,
            "phrase_safe": 1,
            "neither": 1,
        }

    def test_empty_list(self) -> None:
        counts = summarize([])
        assert counts == {
            "forced": 0,
            "ceiling": 0,
            "lookahead": 0,
            "inside_token": 0,
            "phrase_safe": 0,
            "neither": 0,
        }
