"""The per-tag engine map is load-bearing, so it gets a test.

`check_complete` walks every tag against that tag's own engines, and
`score_intelligibility` refuses to score anything at all while that gate is red.
Put the int8 arm into a shared engine list and r1/r2 — the recorded 3.3.0
evidence, which has no int8 WAVs and never will — immediately report as
incomplete, taking the whole scoring stage down with them. Nothing about that
failure is visible until someone tries to score, which is far too late.
"""

from run_benchmark import RUN_TAGS, TAG_ENGINES, arms


def test_recorded_tags_still_measure_the_two_engines_they_were_scored_with():
    for tag in ("r1", "r2"):
        engine_ids = [engine_id for engine_id, _gender, _voice in arms(tag)]
        assert set(engine_ids) == {"vieneu-vi", "zerotts-vi"}
        # Two engines x two genders. A third arm here would fail the tag's gate.
        assert len(engine_ids) == 4


def test_the_upgrade_tag_adds_int8_without_adding_it_to_the_older_tags():
    assert "vieneu-vi-int8" in {e for e, _g, _v in arms("v381")}
    assert "vieneu-vi-int8" not in {e for e, _g, _v in arms("r1")}


def test_run_tags_is_derived_from_the_engine_map():
    # A tag present in one and not the other would be measured by nothing, or
    # measured while no gate covers it.
    assert RUN_TAGS == list(TAG_ENGINES)


def test_every_tag_measures_both_genders_of_every_engine_it_names():
    for tag in RUN_TAGS:
        genders: dict[str, set[str]] = {}
        for engine_id, gender, _voice in arms(tag):
            genders.setdefault(engine_id, set()).add(gender)
        for engine_id, found in genders.items():
            assert found == {"female", "male"}, f"{tag}/{engine_id} has {sorted(found)}"
