import pytest

from mos_bench.form import render_form
from mos_bench.session import build_session
from tests.helpers import make_balanced_clips


def build_form(seed: int = 42, n: int = 4) -> str:
    session = build_session(make_balanced_clips(n=n), ["L01"], seed=seed)
    items = [
        {"item_id": item.item_id, "audio_file": f"{item.blind_id}.wav"}
        for item in session.playlists["L01"]
    ]
    return render_form("L01", seed, items)


def test_form_never_names_a_system():
    # The blinding is only real if it survives someone reading the page source.
    form = build_form()
    assert "alpha" not in form
    assert "beta" not in form


def test_form_never_carries_a_source_path_or_clip_id():
    form = build_form()
    assert "clips/" not in form
    assert "u00" not in form


def test_form_references_only_blinded_audio_names():
    session = build_session(make_balanced_clips(), ["L01"], seed=42)
    items = [
        {"item_id": item.item_id, "audio_file": f"{item.blind_id}.wav"}
        for item in session.playlists["L01"]
    ]
    form = render_form("L01", 42, items)
    for blind_id in session.blind_of_stimulus.values():
        assert f"audio/{blind_id}.wav" in form


def test_form_has_one_control_group_per_item():
    session = build_session(make_balanced_clips(n=3), ["L01"], seed=1)
    items = [
        {"item_id": item.item_id, "audio_file": f"{item.blind_id}.wav"}
        for item in session.playlists["L01"]
    ]
    form = render_form("L01", 1, items)
    assert form.count("<audio") == len(items)
    # Each item carries the full 5-point scale as its own radio group.
    for item in items:
        assert form.count(f'name="{item["item_id"]}"') == 5


def test_form_rejects_an_empty_playlist():
    with pytest.raises(ValueError, match="no items"):
        render_form("L01", 1, [])


def test_form_escapes_a_hostile_listener_id():
    # json.dumps leaves `/` alone, so an unescaped id containing `</script>`
    # would close the script block early and spill the rest as markup.
    form = render_form("<script>x</script>", 1, [{"item_id": "i-0000", "audio_file": "c-0000.wav"}])
    assert "<script>x</script>" not in form
    assert "&lt;script&gt;" in form  # escaped into the visible page
    assert "<\\/script>" in form  # escaped into the embedded JSON
