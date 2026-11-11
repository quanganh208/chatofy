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


def _cap(text, max_chars=20):
    return cap_first_clause(split_into_clauses(text), max_chars)


CAPPED_INPUTS = [
    "Today I went for my check-up exactly as scheduled, then home.",
    "Many countries and tech leaders are warning about new risks",
    "Artificial intelligence has become one of the strategic components",
    "The water level at the station will rise 34 to 35 centimeters above the alert level.",
    "Sometimes you just go to work so that at the end of the month you get your salary.",
]


@pytest.mark.parametrize("text", CAPPED_INPUTS)
def test_cap_cuts_and_keeps_the_text_exactly(text):
    plain = split_into_clauses(text)
    parts = _cap(text)
    assert len(parts) > len(plain)
    assert " ".join(parts) == " ".join(plain)


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_cap_keeps_every_fixture_input(case):
    assert " ".join(_cap(case["input"])) == " ".join(case["parts"])


def test_cap_cuts_a_long_first_clause_only():
    assert _cap("Today I went for my check-up exactly as scheduled, then home.") == [
        "Today I went",
        "for my check-up exactly as scheduled,",
        "then home.",
    ]


def test_cap_prefers_a_cut_before_a_phrase_start():
    # "Many countries and" would be later, but the cut lands before "and".
    assert _cap("Many countries and tech leaders are warning about new risks") == [
        "Many countries",
        "and tech leaders are warning about new risks",
    ]


def test_cap_never_cuts_beside_a_digit():
    # "It rose to" ends on a function word and "It rose to 150" on a digit.
    text = "It rose to 150 centimeters above the old mark"
    assert _cap(text) == [text]


def test_cap_never_ends_the_head_on_a_function_word():
    # Every later space leaves "will" or "be" at the head's end, or a head over 20.
    assert _cap("Saigon will be twenty to fifty centimeters above") == [
        "Saigon will be twenty to fifty centimeters above"
    ]


def test_cap_leaves_a_short_remainder_whole():
    assert _cap("Extraordinarily big day") == ["Extraordinarily big day"]


def test_cap_leaves_one_long_token_whole():
    token = "Supercalifragilisticexpialidocious!"
    assert _cap(token) == [token]


def test_no_cap_is_the_plain_splitter():
    text = "A suitable option would be for businesses to also balance savings."
    assert cap_first_clause(split_into_clauses(text), None) == split_into_clauses(text)


def test_short_first_clause_is_untouched():
    assert _cap("But no, the doctor said so.") == ["But no,", "the doctor said so."]


LONG = (
    "The water level at the station will fluctuate at a high level and is forecast"
    " to rise again through the weekend across the whole delta region"
)


def test_cap_chains_a_long_remainder_and_keeps_every_word():
    parts = _cap(LONG + ".")
    assert len(parts) >= 3
    assert " ".join(parts) == LONG + "."
    for previous, piece in zip(parts, parts[1:]):
        assert len(piece) <= max(45, 3 * len(previous)) or piece == parts[-1]


def test_cap_never_cuts_beside_a_digit_in_any_piece():
    parts = _cap("The water level at the station will rise 34 to 35 centimeters above the alert level by Friday.")
    for a, b in zip(parts, parts[1:]):
        assert not (a[-1].isdigit() or b[0].isdigit())


def test_cap_leaves_a_remainder_within_budget_whole():
    # A 20-char head, then 31 chars: under the 45-char floor, so it is not cut again.
    assert _cap("Honestly the weather turned out better than we hoped") == [
        "Honestly the weather",
        "turned out better than we hoped",
    ]


def test_cap_keeps_a_two_word_head_together():
    parts = _cap("Artificial intelligence has become one of the strategic components")
    assert parts[0] == "Artificial intelligence"


def test_function_word_rule_sees_tabs_and_newlines():
    parts = _cap("Today I  went\tfor my\ncheck-up exactly as scheduled")
    for piece in parts[:-1]:
        assert piece.split()[-1].lower() not in {"for", "my", "i"}


def test_currency_sign_counts_as_a_digit():
    for a, b in zip(parts := _cap("Prices hit $150 yesterday across all the markets"), parts[1:]):
        assert not b.startswith("$")


def test_only_kokoro_english_caps_its_first_clause():
    from engines.kokoro_en import KokoroEn
    from engines.kokoro_zh import KokoroZh
    from engines.kokoro_runtime import SharedKokoroEngine

    assert KokoroEn.FIRST_CLAUSE_CAP_CHARS == 20
    assert KokoroZh.FIRST_CLAUSE_CAP_CHARS is None
    assert SharedKokoroEngine.FIRST_CLAUSE_CAP_CHARS is None
