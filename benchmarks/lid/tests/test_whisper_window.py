"""How long a mel the windowed Whisper arm encodes for a turn."""

import importlib.util
from pathlib import Path

import numpy as np

spec = importlib.util.spec_from_file_location(
    "whisper_arm", Path(__file__).resolve().parents[1] / "arms" / "whisper_probs" / "arm.py")
arm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(arm)

RATE = arm.RATE


def seconds(s: float) -> np.ndarray:
    return np.zeros(int(s * RATE), dtype=np.float32)


def test_sizes_name_their_window_floor():
    assert arm.min_window_s("base") is None
    assert arm.min_window_s("base_ctx") == 1
    assert arm.min_window_s("base_ctx5") == 5
    assert arm.base_size("base_ctx5") == "base"


def test_turn_rounds_up_to_a_whole_second():
    assert arm.window_samples(seconds(2.2), 1) == 3 * RATE


def test_short_turn_is_padded_to_the_floor():
    assert arm.window_samples(seconds(0.8), 5) == 5 * RATE
    assert arm.window_samples(seconds(0.8), 1) == 1 * RATE


def test_long_turn_ignores_the_floor_and_caps_at_30_s():
    assert arm.window_samples(seconds(7.5), 5) == 8 * RATE
    assert arm.window_samples(seconds(41), 5) == 30 * RATE
