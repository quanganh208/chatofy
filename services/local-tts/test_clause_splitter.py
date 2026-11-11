"""The Python splitter against the fixture the TypeScript splitter is held to.

Model-free on purpose, so it runs anywhere the sidecar's environment does —
this is the only guard against the two copies drifting apart.
"""
import json
from pathlib import Path

import pytest

from engines.clause_splitter import split_into_clauses

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "apps/api/src/modules/translate/audio/clause-splitter.cases.json"
)
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_matches_the_shared_fixture(case):
    assert split_into_clauses(case["input"]) == case["parts"]


# The first-clause cap is the sidecar's alone: the TypeScript splitter has no
# twin, so its cases live here rather than in the shared fixture.
from engines.clause_splitter import cap_first_clause  # noqa: E402

CAP = 30


def _cap(text, max_chars=CAP):
    return cap_first_clause(split_into_clauses(text), max_chars)


# Cuts a listener hears as a pause the speaker could have made.
NATURAL = {
    "There are days when I'm running against a deadline.": [
        "There are days",
        "when I'm running against a deadline.",
    ],
    "It was ten years ago that I had surgery once, and it hurt.": [
        "It was ten years ago",
        "that I had surgery once,",
        "and it hurt.",
    ],
    "To protect production and the lives of the people,": [
        "To protect production",
        "and the lives of the people,",
    ],
    "Before the meeting with China's leader, he spoke.": [
        "Before the meeting",
        "with China's leader,",
        "he spoke.",
    ],
}


@pytest.mark.parametrize("text", NATURAL)
def test_cuts_in_front_of_a_boundary_word(text):
    assert _cap(text) == NATURAL[text]


# Cuts that broke a phrase in an earlier rule, or would here without a guard.
UNCUT = [
    "Principle single origin thinking brings you multidimensional perspectives",
    "Between President Donald Trump and Chairman Xi Jinping",
    "Amodei of Anthropic and Professor Joshua Bengio",
    "Many countries and tech leaders are warning about new risks",
    "Still secretly thinking to myself about it all day long",
    "Saigon will be twenty to fifty centimeters above the mark",
    "Both the US and China are fiercely competing for the lead",
]


@pytest.mark.parametrize("text", UNCUT)
def test_no_cut_without_a_real_boundary(text):
    assert _cap(text) == split_into_clauses(text)


def test_so_that_stays_together():
    parts = _cap("Sometimes you just go to work so that at the end of the month you get your salary.")
    assert parts[0] == "Sometimes you just go to work"
    assert parts[1].startswith("so that")


def test_chained_pieces_keep_the_text_and_their_budget():
    text = (
        "It's probably so that later you can marry a rich husband"
        " and be kept, as they say."
    )
    parts = _cap(text)
    assert " ".join(parts) == " ".join(split_into_clauses(text))
    for previous, piece in zip(parts, parts[1:-1]):
        assert len(piece) <= max(45, 3 * len(previous))


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_cap_keeps_every_fixture_input(case):
    assert " ".join(_cap(case["input"])) == " ".join(case["parts"])


def test_never_cuts_beside_a_digit_or_currency():
    for text in (
        "The level rose by 35 because of the heavy rain upstream",
        "Prices hit $150 because demand rose across all markets",
    ):
        parts = _cap(text)
        for a, b in zip(parts, parts[1:]):
            assert not a[-1].isdigit() and not b.lstrip("$")[:1].isdigit()


def test_function_word_rule_sees_tabs_and_newlines():
    parts = _cap("It was a long day\tand\nwe were all tired by the evening")
    for piece in parts[:-1]:
        assert piece.split()[-1].lower() not in {"and", "a", "we"}


def test_short_first_clause_and_no_cap_are_untouched():
    assert _cap("But no, the doctor said so.") == ["But no,", "the doctor said so."]
    text = "There are days when I'm running against a deadline."
    assert cap_first_clause(split_into_clauses(text), None) == split_into_clauses(text)


def test_only_kokoro_english_caps_its_first_clause():
    from engines.kokoro_en import KokoroEn
    from engines.kokoro_runtime import SharedKokoroEngine
    from engines.kokoro_zh import KokoroZh

    assert KokoroEn.FIRST_CLAUSE_CAP_CHARS == CAP
    assert KokoroZh.FIRST_CLAUSE_CAP_CHARS is None
    assert SharedKokoroEngine.FIRST_CLAUSE_CAP_CHARS is None
