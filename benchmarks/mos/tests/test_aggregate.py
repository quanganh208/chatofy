import json

import numpy as np
import pytest

from mos_bench.aggregate import (
    Rating,
    icc_two_way,
    load_ratings,
    mos_table,
    rating_matrix,
    screen_listeners,
)
from mos_bench.session import build_session
from tests.helpers import make_balanced_clips


def make_key(listeners: list[str], n: int = 4, repeats: int = 1) -> dict:
    session = build_session(
        make_balanced_clips(n=n), listeners, seed=42, repeats_per_listener=repeats
    )
    return session.key_document()


def rate(key: dict, listener: str, score_of_system: dict[str, int]) -> list[Rating]:
    """Rate every item by its system, so expected means are exact."""
    return [
        Rating(listener_id=listener, item_id=item["item_id"], score=score_of_system[item["system"]])
        for item in key["playlists"][listener]
    ]


def test_load_ratings_rejects_out_of_range_score(tmp_path):
    path = tmp_path / "ratings-L01.json"
    path.write_text(
        json.dumps({"listener_id": "L01", "ratings": [{"item_id": "i-0000", "score": 7}]}),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="expected one of"):
        load_ratings([path])


def test_load_ratings_rejects_the_same_listener_twice(tmp_path):
    payload = {"listener_id": "L01", "ratings": [{"item_id": "i-0000", "score": 4}]}
    first = tmp_path / "ratings-L01.json"
    second = tmp_path / "ratings-L01-copy.json"
    first.write_text(json.dumps(payload), encoding="utf-8")
    second.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="more than one file"):
        load_ratings([first, second])


def test_clean_listener_raises_no_flag():
    key = make_key(["L01"])
    ratings = rate(key, "L01", {"alpha": 4, "beta": 2})
    screen = screen_listeners(key, ratings)[0]
    assert screen.flags == []
    assert screen.max_repeat_gap == 0


def test_inconsistent_repeat_ratings_flag_attention():
    key = make_key(["L01"])
    ratings = rate(key, "L01", {"alpha": 4, "beta": 2})
    repeat_item = next(i for i in key["playlists"]["L01"] if i["is_repeat"])
    # The repeat is the same audio; rating it 3 points away is about the listener.
    ratings = [r for r in ratings if r.item_id != repeat_item["item_id"]]
    ratings.append(Rating("L01", repeat_item["item_id"], 5 if repeat_item["system"] == "beta" else 1))
    assert "attention" in screen_listeners(key, ratings)[0].flags


def test_identical_ratings_throughout_flag_flat():
    key = make_key(["L01"])
    ratings = rate(key, "L01", {"alpha": 3, "beta": 3})
    assert "flat" in screen_listeners(key, ratings)[0].flags


def test_skipped_items_flag_incomplete():
    key = make_key(["L01"])
    ratings = rate(key, "L01", {"alpha": 4, "beta": 2})[:-1]
    assert "incomplete" in screen_listeners(key, ratings)[0].flags


def test_unknown_item_id_is_an_error_not_a_flag():
    key = make_key(["L01"])
    ratings = rate(key, "L01", {"alpha": 4, "beta": 2})
    ratings.append(Rating("L01", "i-9999", 3))
    with pytest.raises(ValueError, match="unknown item"):
        screen_listeners(key, ratings)


def test_mos_is_the_mean_of_per_listener_means():
    key = make_key(["L01", "L02", "L03"])
    ratings: list[Rating] = []
    for listener, alpha in zip(["L01", "L02", "L03"], [5, 4, 3]):
        ratings += rate(key, listener, {"alpha": alpha, "beta": 2})
    rows = {r["system"]: r for r in mos_table(key, ratings, {"L01", "L02", "L03"})}
    assert rows["alpha"]["mos"] == pytest.approx(4.0)  # mean of 5, 4, 3
    assert rows["beta"]["mos"] == pytest.approx(2.0)
    assert rows["alpha"]["n_listeners"] == 3


def test_n_is_listeners_not_ratings():
    # 3 listeners x 8 clips is 24 ratings but 3 independent observations. The
    # interval must be the wider one built on n=3.
    key = make_key(["L01", "L02", "L03"], n=4)
    ratings: list[Rating] = []
    for listener, alpha in zip(["L01", "L02", "L03"], [5, 4, 3]):
        ratings += rate(key, listener, {"alpha": alpha, "beta": 2})
    row = next(r for r in mos_table(key, ratings, {"L01", "L02", "L03"}) if r["system"] == "alpha")
    # t(.975, df=2) = 4.303; sd of [5,4,3] = 1; 4.303 * 1 / sqrt(3) = 2.484
    assert row["ci95"] == pytest.approx(2.484, abs=1e-3)


def test_repeat_presentations_do_not_enter_the_mos():
    # Every clip is rated by its system, except the repeated presentation, which
    # is scored 1. Excluding repeats, that system's mean must be untouched.
    key = make_key(["L01"], n=4, repeats=1)
    ratings = rate(key, "L01", {"alpha": 5, "beta": 2})
    repeat_item = next(i for i in key["playlists"]["L01"] if i["is_repeat"])
    repeated_system = repeat_item["system"]
    expected = {"alpha": 5.0, "beta": 2.0}[repeated_system]
    ratings = [r for r in ratings if r.item_id != repeat_item["item_id"]]
    ratings.append(Rating("L01", repeat_item["item_id"], 1))
    row = next(r for r in mos_table(key, ratings, {"L01"}) if r["system"] == repeated_system)
    assert row["mos"] == pytest.approx(expected)


def test_single_listener_reports_no_interval():
    key = make_key(["L01"])
    ratings = rate(key, "L01", {"alpha": 4, "beta": 2})
    row = next(r for r in mos_table(key, ratings, {"L01"}) if r["system"] == "alpha")
    assert np.isnan(row["ci95"])


def test_icc_matches_the_shrout_fleiss_worked_example():
    # Shrout & Fleiss (1979), Table 1: the canonical 6-target x 4-judge set.
    # Published ICC(2,1) = 0.290, ICC(2,k) = 0.620.
    matrix = np.array(
        [
            [9, 2, 5, 8],
            [6, 1, 3, 2],
            [8, 4, 6, 8],
            [7, 1, 2, 6],
            [10, 5, 6, 9],
            [6, 2, 4, 7],
        ],
        dtype=np.float64,
    )
    result = icc_two_way(matrix)
    assert result["icc_2_1"] == pytest.approx(0.290, abs=5e-3)
    assert result["icc_2_k"] == pytest.approx(0.620, abs=5e-3)


def test_icc_is_one_when_listeners_agree_exactly():
    matrix = np.array([[1, 1], [3, 3], [5, 5]], dtype=np.float64)
    assert icc_two_way(matrix)["icc_2_1"] == pytest.approx(1.0)


def test_icc_needs_more_than_one_listener():
    with pytest.raises(ValueError, match="at least 2 clips and 2 listeners"):
        icc_two_way(np.array([[1.0], [2.0], [3.0]]))


def test_rating_matrix_rejects_an_incomplete_panel():
    key = make_key(["L01", "L02"])
    ratings = rate(key, "L01", {"alpha": 4, "beta": 2})
    ratings += rate(key, "L02", {"alpha": 3, "beta": 2})[:-2]
    with pytest.raises(ValueError, match="incomplete"):
        rating_matrix(key, ratings, {"L01", "L02"}, "vi")


def test_rating_matrix_is_clips_by_listeners():
    key = make_key(["L01", "L02"], n=4)
    ratings = rate(key, "L01", {"alpha": 4, "beta": 2}) + rate(
        key, "L02", {"alpha": 3, "beta": 2}
    )
    matrix = rating_matrix(key, ratings, {"L01", "L02"}, "vi")
    assert matrix.shape == (8, 2)  # 4 clip_ids x 2 systems = 8 stimuli, 2 listeners
