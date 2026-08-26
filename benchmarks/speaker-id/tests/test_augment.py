"""Tests for the far-field simulation.

Acoustics has no analytic oracle the way EER does, which is exactly why the
hand-rolled image-source method that lived here first went undetected until its
parameters were swept: its RT60 tracked the array bound rather than the wall
absorption. These tests therefore check the properties that would have caught
that — RT60 responds to the room, the tail decays, alignment is preserved — and
not merely that a number comes back.
"""

from __future__ import annotations

import numpy as np
import pytest

from speaker_bench.augment import (
    DEFAULT_SNR_DB,
    RoomConfig,
    add_noise,
    apply_rir,
    build_rir,
    direct_path_index,
    far_field,
)

SAMPLE_RATE = 16_000


@pytest.fixture(scope="module")
def rir_and_rt60() -> tuple[np.ndarray, float]:
    return build_rir(RoomConfig())


# --- the room -------------------------------------------------------------


def test_rt60_responds_to_the_room_not_to_the_array_length() -> None:
    """The property the hand-rolled implementation failed.

    Its RT60 sat at ~0.75x the array length for every absorption value, because
    the tail was truncated rather than decaying. A longer requested RT60 must
    produce a measurably longer one.
    """
    _, short = build_rir(RoomConfig(rt60_s=0.25))
    _, long = build_rir(RoomConfig(rt60_s=0.7))

    assert long > short * 1.5, f"RT60 barely moved: {short:.3f} -> {long:.3f}"


def test_rt60_is_in_a_plausible_room_range(rir_and_rt60) -> None:
    _, rt60 = rir_and_rt60
    # Sabine is an approximation and the image-source tail runs longer than it
    # predicts, so the measured value exceeds the 0.40s request. What matters is
    # that it lands in the range of a real room rather than a cathedral.
    assert 0.3 < rt60 < 0.8, rt60


def test_source_distance_is_the_far_field_it_claims() -> None:
    assert RoomConfig().source_distance_m == pytest.approx(2.0, abs=0.1)


def test_rir_energy_decays(rir_and_rt60) -> None:
    rir, _ = rir_and_rt60
    energy = rir.astype(np.float64) ** 2
    third = len(energy) // 3
    early, late = energy[:third].sum(), energy[-third:].sum()
    assert late < early * 0.01, "a reverberant tail must decay, not sustain"


def test_rir_is_normalised_on_the_direct_arrival(rir_and_rt60) -> None:
    """Unit DIRECT-path gain, so convolution does not change level.

    Normalising on the peak instead would scale every clip by however loud a
    coherent reflection happened to be — a volume change the extractor could
    read as distance, making the far-field cell measure loudness.
    """
    rir, _ = rir_and_rt60
    assert abs(float(rir[direct_path_index(rir)])) == pytest.approx(1.0)


def test_direct_path_ignores_a_louder_later_reflection() -> None:
    """Regression guard for a real bug, tested on the function not the room.

    The default geometry originally put source and microphone on the room's
    centre line, so both side-wall reflections travelled identical paths and
    summed to something LOUDER than the direct arrival. `argmax` then landed
    ~200 samples late and shifted every reverberated clip against its dry
    counterpart. Moving the geometry off-centre removed that from this room, so
    asserting it about the room would now be asserting a coincidence — the
    property that must hold is that the FUNCTION picks the first significant
    arrival even when a later one is louder.
    """
    rir = np.zeros(1000, dtype=np.float32)
    rir[100] = 1.0   # direct
    rir[300] = 2.5   # coherent reflection, louder

    assert direct_path_index(rir) == 100
    assert int(np.argmax(np.abs(rir))) == 300


def test_direct_path_ignores_filter_ringing_below_the_threshold() -> None:
    """Pre-ringing from the fractional-delay filter must not read as arrival."""
    rir = np.zeros(1000, dtype=np.float32)
    rir[90:100] = 0.1   # ringing at 10% of peak
    rir[100] = 1.0

    assert direct_path_index(rir) == 100


def test_direct_path_matches_geometry_plus_the_filter_offset(rir_and_rt60) -> None:
    rir, _ = rir_and_rt60
    geometric = RoomConfig().source_distance_m / 343.0 * SAMPLE_RATE
    # pyroomacoustics prepends about half its 81-tap fractional-delay filter.
    assert direct_path_index(rir) == pytest.approx(geometric + 40, abs=15)


def test_direct_path_refuses_a_silent_rir() -> None:
    with pytest.raises(ValueError, match="silent"):
        direct_path_index(np.zeros(100))


# --- convolution ----------------------------------------------------------


def test_apply_rir_preserves_length() -> None:
    """A duration bucket claims an exact length; reverb must not change it."""
    dry = np.random.default_rng(0).normal(0, 0.1, SAMPLE_RATE * 2).astype(np.float32)
    rir, _ = build_rir(RoomConfig())
    assert len(apply_rir(dry, rir)) == len(dry)


def test_apply_rir_keeps_the_clip_time_aligned() -> None:
    """Trimming from the direct path, not from sample zero.

    Otherwise propagation delay would be counted as speech, and a 2s bucket
    would hold 2s minus the flight time of sound across the room.
    """
    dry = np.zeros(SAMPLE_RATE, dtype=np.float32)
    dry[0] = 1.0
    rir, _ = build_rir(RoomConfig())
    wet = apply_rir(dry, rir)

    # The direct arrival of the convolved impulse must sit at sample 0. Checking
    # argmax would be wrong in a reverberant room, where a later reflection can
    # be the loudest sample.
    assert direct_path_index(wet) == 0


def test_reverberation_actually_changes_the_signal() -> None:
    """A no-op far-field condition would make the gate cell meaningless."""
    dry = np.random.default_rng(1).normal(0, 0.1, SAMPLE_RATE).astype(np.float32)
    rir, _ = build_rir(RoomConfig())
    wet = apply_rir(dry, rir)

    correlation = float(np.corrcoef(dry, wet)[0, 1])
    assert correlation < 0.9, "reverberation left the signal essentially unchanged"


# --- noise ----------------------------------------------------------------


@pytest.mark.parametrize("snr_db", [5.0, 15.0, 25.0])
def test_noise_lands_at_the_requested_snr(snr_db: float) -> None:
    rng = np.random.default_rng(2)
    signal = rng.normal(0, 0.2, SAMPLE_RATE * 3).astype(np.float32)
    noisy = add_noise(signal, rng, snr_db=snr_db)

    noise = noisy - signal
    measured = 10 * np.log10(np.mean(signal.astype(np.float64) ** 2) / np.mean(noise**2))
    assert measured == pytest.approx(snr_db, abs=0.5)


def test_snr_is_per_clip_so_a_quiet_talker_is_not_buried() -> None:
    rng = np.random.default_rng(3)
    loud = rng.normal(0, 0.5, SAMPLE_RATE).astype(np.float32)
    quiet = (loud * 0.01).astype(np.float32)

    for clip in (loud, quiet):
        noisy = add_noise(clip, np.random.default_rng(4), snr_db=DEFAULT_SNR_DB)
        noise = noisy - clip
        measured = 10 * np.log10(np.mean(clip.astype(np.float64) ** 2) / np.mean(noise**2))
        assert measured == pytest.approx(DEFAULT_SNR_DB, abs=0.5)


def test_noise_refuses_a_silent_signal() -> None:
    """An SNR against silence is undefined; returning something would hide a bug."""
    with pytest.raises(ValueError, match="silent"):
        add_noise(np.zeros(1000, dtype=np.float32), np.random.default_rng(5))


# --- composition ----------------------------------------------------------


def test_far_field_reverberates_before_adding_noise() -> None:
    """The physical order.

    Noise added first would be reverberated too, modelling a noise source inside
    the room rather than sensor and HVAC noise reaching the mic directly.
    Detectable because reverberating noise correlates it across time, lowering
    its sample-to-sample independence.
    """
    rng = np.random.default_rng(6)
    signal = rng.normal(0, 0.2, SAMPLE_RATE * 2).astype(np.float32)
    rir, _ = build_rir(RoomConfig())

    correct = far_field(signal, rir, np.random.default_rng(7))
    reversed_order = apply_rir(add_noise(signal, np.random.default_rng(7)), rir)

    residual_correct = correct - apply_rir(signal, rir)
    residual_reversed = reversed_order - apply_rir(signal, rir)
    # Lag-1 autocorrelation: white at the mic, coloured if reverberated.
    def lag1(x: np.ndarray) -> float:
        return float(np.corrcoef(x[:-1], x[1:])[0, 1])

    assert abs(lag1(residual_correct)) < abs(lag1(residual_reversed))


def test_far_field_preserves_length() -> None:
    signal = np.random.default_rng(8).normal(0, 0.1, SAMPLE_RATE * 2).astype(np.float32)
    rir, _ = build_rir(RoomConfig())
    assert len(far_field(signal, rir, np.random.default_rng(9))) == len(signal)


def test_far_field_output_is_float32() -> None:
    """The extractor takes float32; a float64 array would be copied silently."""
    signal = np.random.default_rng(10).normal(0, 0.1, SAMPLE_RATE).astype(np.float32)
    rir, _ = build_rir(RoomConfig())
    assert far_field(signal, rir, np.random.default_rng(11)).dtype == np.float32
