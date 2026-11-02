"""Cutting Scribe's words into turns by time.

    python3 -I -m pytest benchmarks/translation-judge/tests  (or: uv run --no-project --with pytest pytest …)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scribe_turns import LEAD_MS, slice_words  # noqa: E402


def w(start_ms, end_ms, text):
    return (start_ms / 1000, end_ms / 1000, text)


def test_each_word_goes_to_the_turn_whose_window_holds_its_midpoint():
    words = [w(0, 400, "a"), w(500, 900, "b"), w(5000, 5400, "c"), w(9000, 9400, "d")]
    texts, dropped = slice_words(words, [0, 4000, 8000])
    assert texts == ["a b", "c", "d"]
    assert dropped == 0


def test_a_word_just_before_the_stamp_belongs_to_the_turn_it_opens():
    # The turn was stamped 200 ms after its first word started.
    words = [w(1000, 1500, "first"), w(3800, 4000, "early"), w(4100, 4400, "next")]
    texts, _ = slice_words(words, [1000, 4100])
    assert texts == ["first", "early next"]


def test_no_word_is_given_to_two_turns():
    words = [w(i * 100, i * 100 + 80, str(i)) for i in range(100)]
    texts, dropped = slice_words(words, [0, 3000, 6000])
    joined = " ".join(t for t in texts if t).split()
    assert len(joined) + dropped == 100
    assert len(set(joined)) == len(joined)


def test_words_before_the_first_turn_are_dropped_and_counted():
    words = [w(0, 200, "intro"), w(2000, 2200, "turn")]
    texts, dropped = slice_words(words, [2000])
    assert texts == ["turn"]
    assert dropped == 1


def test_a_turn_without_time_or_words_gets_none():
    words = [w(0, 200, "a"), w(5000, 5200, "b")]
    texts, _ = slice_words(words, [0, None, 4000, 4100 + LEAD_MS])
    assert texts[1] is None
    assert texts[0] == "a"
    # 4000 owns [3700, 4100); 4400 owns from 4100 on, so "b" (mid 5100) is the last turn's.
    assert texts[2] is None
    assert texts[3] == "b"


def test_turns_out_of_order_in_time_still_slice_by_time():
    words = [w(0, 100, "a"), w(6000, 6100, "b")]
    texts, _ = slice_words(words, [5000, 0])
    assert texts == ["b", "a"]
