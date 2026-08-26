import json

import pytest

from mos_bench.manifest import assert_balanced, load_clips
from mos_bench.session import build_session
from tests.helpers import make_balanced_clips, make_unbalanced_clips


def test_load_clips_rejects_the_same_clip_twice_for_one_system(tmp_path):
    manifest = tmp_path / "clips.jsonl"
    row = {"clip_id": "u01", "system": "alpha", "lang": "vi", "path": "a.wav"}
    manifest.write_text(json.dumps(row) + "\n" + json.dumps(row) + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match="duplicate clip"):
        load_clips(manifest)


def test_load_clips_accepts_one_clip_id_across_systems(tmp_path):
    # This is the balanced case, not a mistake: every system renders the same
    # material, so clip_id u01 must be allowed to appear once per system.
    manifest = tmp_path / "clips.jsonl"
    manifest.write_text(
        "\n".join(
            json.dumps({"clip_id": "u01", "system": system, "lang": "vi", "path": f"{system}.wav"})
            for system in ("alpha", "beta")
        )
        + "\n",
        encoding="utf-8",
    )
    clips = load_clips(manifest)
    assert [c.stimulus_id for c in clips] == ["alpha::u01", "beta::u01"]


def test_load_clips_rejects_missing_field(tmp_path):
    manifest = tmp_path / "clips.jsonl"
    manifest.write_text(json.dumps({"clip_id": "u01", "system": "alpha"}) + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match="missing field"):
        load_clips(manifest)


def test_assert_balanced_rejects_a_system_missing_a_clip():
    clips = make_balanced_clips(n=3)
    clips = [c for c in clips if not (c.system == "beta" and c.clip_id == "u02")]
    with pytest.raises(ValueError, match="unbalanced"):
        assert_balanced(clips)


def test_unbalanced_clip_ids_are_rejected_at_session_build():
    # Each system has its own clip_ids, so no listener would rate the two systems
    # on the same material.
    with pytest.raises(ValueError, match="unbalanced"):
        build_session(make_unbalanced_clips(), ["L01"], seed=1)


def test_every_clip_gets_a_unique_blind_name():
    clips = make_balanced_clips()
    session = build_session(clips, ["L01"], seed=7)
    blind_names = list(session.blind_of_stimulus.values())
    assert len(blind_names) == len(clips)
    assert len(set(blind_names)) == len(blind_names)


def test_the_same_material_from_two_systems_gets_two_blind_names():
    # The whole comparison collapses if alpha's and beta's rendering of u00 share
    # one audio file.
    session = build_session(make_balanced_clips(), ["L01"], seed=7)
    assert session.blind_of_stimulus["alpha::u00"] != session.blind_of_stimulus["beta::u00"]


def test_blind_names_do_not_follow_system_grouping():
    # Manifests are grouped by system. If blind ids were handed out in manifest
    # order, c-0000..c-0003 would all be one system and the blinding would be
    # decorative. The shuffle must break that block structure.
    clips = make_balanced_clips(n=8)
    session = build_session(clips, ["L01"], seed=3)
    alpha_indices = sorted(
        int(session.blind_of_stimulus[c.stimulus_id].split("-")[1])
        for c in clips
        if c.system == "alpha"
    )
    assert alpha_indices != list(range(len(alpha_indices)))


def test_same_seed_reproduces_identical_playlists():
    first = build_session(make_balanced_clips(), ["L01", "L02"], seed=99)
    second = build_session(make_balanced_clips(), ["L01", "L02"], seed=99)
    assert first.playlists == second.playlists


def test_listeners_get_different_orders():
    session = build_session(make_balanced_clips(n=8), ["L01", "L02"], seed=5)
    first = [item.clip_id for item in session.playlists["L01"]]
    second = [item.clip_id for item in session.playlists["L02"]]
    assert first != second


def test_repeats_are_added_and_only_the_second_is_marked():
    session = build_session(make_balanced_clips(n=5), ["L01"], seed=11, repeats_per_listener=2)
    items = session.playlists["L01"]
    assert len(items) == 12  # 5 clips x 2 systems, + 2 repeats
    assert sum(item.is_repeat for item in items) == 2
    for index, item in enumerate(items):
        earlier = [i for i in items[:index] if i.stimulus_id == item.stimulus_id]
        assert item.is_repeat == bool(earlier)


def test_repeated_item_points_at_the_same_audio():
    session = build_session(make_balanced_clips(n=5), ["L01"], seed=11, repeats_per_listener=2)
    items = session.playlists["L01"]
    repeats = [i for i in items if i.is_repeat]
    assert repeats
    for repeat in repeats:
        original = next(
            i for i in items if i.stimulus_id == repeat.stimulus_id and not i.is_repeat
        )
        assert repeat.blind_id == original.blind_id


def test_item_ids_are_sequential_and_carry_no_signal():
    session = build_session(make_balanced_clips(n=4), ["L01"], seed=2, repeats_per_listener=0)
    ids = [item.item_id for item in session.playlists["L01"]]
    assert ids == [f"i-{index:04d}" for index in range(len(ids))]


def test_duplicate_listener_ids_are_rejected():
    with pytest.raises(ValueError, match="unique"):
        build_session(make_balanced_clips(), ["L01", "L01"], seed=1)


def test_empty_panel_is_rejected():
    with pytest.raises(ValueError, match="at least one listener"):
        build_session(make_balanced_clips(), [], seed=1)


def test_more_repeats_than_clips_is_rejected():
    with pytest.raises(ValueError, match="cannot repeat"):
        build_session(make_balanced_clips(n=2), ["L01"], seed=1, repeats_per_listener=99)
