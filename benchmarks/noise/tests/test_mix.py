"""The mixing arithmetic, tested where it lives — no service, no model, no WAVs.

Only `noise_bench.mix` is imported, so these run in an ephemeral numpy+pytest env
without syncing the project's STT dependencies:

    uv run --no-project --with numpy --with pytest python -m pytest tests/test_mix.py
"""

import numpy as np
import pytest

from noise_bench.mix import (
    achieved_snr_db,
    fit_length,
    mix_at_snr,
    rms,
    scale_noise_for_snr,
)


def _speech(seconds: float = 1.0, rate: int = 16000) -> np.ndarray:
    """A 220 Hz tone at a speech-like level — a stand-in for the RMS, not the
    shape, which is all the SNR arithmetic cares about."""
    t = np.arange(int(seconds * rate))
    return 0.2 * np.sin(2 * np.pi * 220 * t / rate)


@pytest.mark.parametrize("snr_db", [20.0, 10.0, 5.0, 0.0, -5.0])
def test_scale_hits_the_target_snr(snr_db: float) -> None:
    rng = np.random.default_rng(0)
    clean = _speech()
    noise = rng.standard_normal(clean.size) * 0.5

    gain = scale_noise_for_snr(clean, noise, snr_db)

    # The definition, measured back on the scaled component: it must equal target.
    assert achieved_snr_db(clean, gain * noise) == pytest.approx(snr_db, abs=1e-6)


def test_a_lower_snr_means_a_louder_noise_bed() -> None:
    clean = _speech()
    rng = np.random.default_rng(1)
    noise = rng.standard_normal(clean.size) * 0.3

    quiet = scale_noise_for_snr(clean, noise, 20.0)
    loud = scale_noise_for_snr(clean, noise, 0.0)

    assert loud > quiet


def test_mix_length_follows_the_clean_utterance() -> None:
    clean = _speech(seconds=1.0)
    rng = np.random.default_rng(2)
    short_noise = rng.standard_normal(4000) * 0.4  # a quarter of the utterance

    mixed = mix_at_snr(clean, short_noise, 10.0)

    # Tiled, never truncated — the bed covers the whole sentence.
    assert mixed.shape[0] == clean.shape[0]


def test_mix_never_clips_the_output() -> None:
    clean = _speech()
    rng = np.random.default_rng(3)
    # A negative SNR makes the noise louder than the speech, which without the
    # peak limit would overflow [-1, 1] and clip as a click.
    loud_noise = rng.standard_normal(clean.size) * 0.9

    mixed = mix_at_snr(clean, loud_noise, -10.0)

    assert np.max(np.abs(mixed)) <= 1.0


def test_peak_limiting_preserves_the_snr() -> None:
    # A mix that has to be scaled back into range must still measure at the target
    # SNR, because speech and noise are scaled by the same factor.
    clean = _speech()
    rng = np.random.default_rng(4)
    noise = rng.standard_normal(clean.size) * 0.9
    snr_db = -6.0

    gain = scale_noise_for_snr(clean, noise, snr_db)
    fitted = gain * noise
    mixed = clean + fitted
    peak = np.max(np.abs(mixed))
    assert peak > 1.0  # this case really does clip without limiting

    # After the same limiting mix_at_snr applies, both parts share the factor.
    factor = 1.0 / peak
    assert achieved_snr_db(clean * factor, fitted * factor) == pytest.approx(snr_db, abs=1e-6)


def test_fit_length_offset_draws_a_different_stretch() -> None:
    noise = np.arange(100, dtype=np.float64)

    head = fit_length(noise, 10, offset=0)
    shifted = fit_length(noise, 10, offset=50)

    assert head[0] == 0
    assert shifted[0] == 50
    assert not np.array_equal(head, shifted)


def test_silent_inputs_are_an_error_not_a_silent_nan() -> None:
    clean = _speech()
    silence = np.zeros_like(clean)

    with pytest.raises(ValueError):
        scale_noise_for_snr(clean, silence, 10.0)
    with pytest.raises(ValueError):
        scale_noise_for_snr(silence, clean, 10.0)


def test_rms_of_silence_is_zero_not_a_crash() -> None:
    assert rms(np.zeros(10)) == 0.0
    assert rms(np.array([])) == 0.0
