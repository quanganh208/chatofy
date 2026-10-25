import json

import pytest

from lid_bench.manifest import Turn, bucket_for, load, opaque_id, save


def turn(**overrides) -> Turn:
    base = dict(id="a", audio="data/x.wav", lang="vi", bucket="1.5-3", speech_ms=2000, channel="laptop",
                group="g", source="prod", real=True, license="private")
    return Turn(**{**base, **overrides})


def test_bucket_bounds_belong_to_the_bucket_above():
    assert bucket_for(1499) == "<1.5"
    assert bucket_for(1500) == "1.5-3"
    assert bucket_for(3000) == "3-8"
    # Longer than the ceiling still counts, in the top bucket.
    assert bucket_for(9000) == "3-8"


def test_round_trip(tmp_path):
    path = tmp_path / "m.jsonl"
    save(path, [turn(), turn(id="b", lang="noise", noise=True, bucket="<1.5", speech_ms=0)])
    assert [t.id for t in load(path)] == ["a", "b"]


@pytest.mark.parametrize("overrides", [
    {"lang": "fr"},
    {"lang": "noise"},  # noise label without the flag
    {"bucket": "<1.5"},  # bucket disagrees with speech_ms
    {"session": "s"},  # session without order
    {"declared_source": "fr"},
])
def test_invalid_rows_are_refused(overrides):
    with pytest.raises(ValueError):
        turn(**overrides).validate()


def test_duplicate_and_unknown_fields_are_refused(tmp_path):
    path = tmp_path / "m.jsonl"
    row = json.dumps(turn().__dict__)
    path.write_text(row + "\n" + row + "\n")
    with pytest.raises(ValueError, match="duplicate"):
        load(path)
    path.write_text(json.dumps({**turn().__dict__, "text": "hello"}) + "\n")
    with pytest.raises(ValueError, match="unknown"):
        load(path)


def test_opaque_id_is_stable_and_does_not_contain_its_input():
    conversation = "2499c493-7609-42e5-b21e-fa82ae1b4b9f"
    assert opaque_id(conversation, "3") == opaque_id(conversation, "3")
    assert opaque_id(conversation, "3") != opaque_id(conversation, "4")
    assert conversation[:8] not in opaque_id(conversation, "3")
