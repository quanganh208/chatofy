"""Add noise to clean speech at a chosen signal-to-noise ratio.

SNR is defined the ordinary way — the ratio of speech power to noise power, in
decibels — and the mix is built to hit a *target* SNR so a WER curve can be read
against a number that means the same thing at every point. Everything here is
pure numpy on mono float samples in [-1, 1]; WAV I/O is the two thin wrappers at
the bottom.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

TARGET_SAMPLE_RATE = 16000


def rms(signal: np.ndarray) -> float:
    """Root-mean-square level of a signal, in the same units as its samples."""
    if signal.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(signal, dtype=np.float64))))


def fit_length(noise: np.ndarray, length: int, offset: int = 0) -> np.ndarray:
    """Tile or crop `noise` to exactly `length` samples.

    A noise recording is rarely the length of the utterance it is laid under.
    Shorter is tiled so the bed never falls silent mid-sentence; longer is cropped
    from `offset`, which lets a caller draw a different stretch of the same
    recording for each utterance rather than always the first seconds.
    """
    if length <= 0:
        raise ValueError(f"length must be positive, got {length}")
    if noise.size == 0:
        raise ValueError("noise is empty")
    if noise.size < length:
        repeats = -(-length // noise.size)  # ceil division
        noise = np.tile(noise, repeats)
    start = offset % noise.size
    rolled = np.concatenate([noise[start:], noise[:start]]) if start else noise
    return rolled[:length]


def scale_noise_for_snr(clean: np.ndarray, noise: np.ndarray, snr_db: float) -> float:
    """The gain to apply to `noise` so clean-to-noise ratio is exactly `snr_db`.

    From `snr_db = 20·log10(rms(clean) / rms(g·noise))`, solved for `g`. Returned
    rather than applied so a caller can inspect it and a test can assert on it
    without re-deriving the mix.
    """
    clean_rms = rms(clean)
    noise_rms = rms(noise)
    if noise_rms == 0:
        raise ValueError("noise is silent; SNR is undefined")
    if clean_rms == 0:
        raise ValueError("clean signal is silent; SNR is undefined")
    return clean_rms / (noise_rms * (10.0 ** (snr_db / 20.0)))


def mix_at_snr(
    clean: np.ndarray,
    noise: np.ndarray,
    snr_db: float,
    offset: int = 0,
) -> np.ndarray:
    """Clean speech with `noise` laid under it at `snr_db`.

    The noise is fit to the utterance's length, scaled to the target ratio, and
    added. If the sum clips, the whole mix is scaled back into range — which is
    safe for the SNR because scaling speech and noise by the same factor leaves
    their ratio untouched, so the number the curve is read against is unchanged.
    """
    noise = fit_length(noise, clean.shape[0], offset)
    gain = scale_noise_for_snr(clean, noise, snr_db)
    mixed = clean + gain * noise

    peak = float(np.max(np.abs(mixed))) if mixed.size else 0.0
    if peak > 1.0:
        mixed = mixed / peak
    return mixed.astype(np.float32)


def achieved_snr_db(clean: np.ndarray, noise_component: np.ndarray) -> float:
    """Measured SNR of a mix's two parts — the check that `mix_at_snr` hit target.

    Only meaningful when the noise component is available separately, which it is
    inside a test (`gain * fit_length(noise)`); a finished mix cannot be
    un-added.
    """
    noise_rms = rms(noise_component)
    if noise_rms == 0:
        return float("inf")
    return 20.0 * np.log10(rms(clean) / noise_rms)


def load_wav_mono(path: Path) -> tuple[np.ndarray, int]:
    """One WAV as mono float64, averaging channels rather than dropping any.

    `soundfile` is imported here rather than at module top so the mixing core
    above stays numpy-only and its tests need no audio-IO library.
    """
    import soundfile as sf

    samples, rate = sf.read(str(path), dtype="float64", always_2d=True)
    return samples.mean(axis=1), int(rate)


def resample_to_16k(signal: np.ndarray, rate: int) -> np.ndarray:
    """Linear resample to 16 kHz — the rate the STT models take.

    Linear is enough here for the same reason the app's own resampler settles for
    it: the recognizer is unbothered by the aliasing a sharper filter removes, and
    the mixing this feeds is itself an approximation of a real room.
    """
    if rate == TARGET_SAMPLE_RATE:
        return signal
    if rate <= 0:
        raise ValueError(f"invalid sample rate {rate}")
    duration = signal.size / rate
    target_len = int(round(duration * TARGET_SAMPLE_RATE))
    source_x = np.arange(signal.size)
    target_x = np.linspace(0, signal.size - 1, target_len)
    return np.interp(target_x, source_x, signal)


def save_wav_16k(path: Path, signal: np.ndarray) -> None:
    """Write a mono 16 kHz PCM16 WAV — what the sidecar's decoder expects."""
    import soundfile as sf

    clipped = np.clip(signal, -1.0, 1.0)
    sf.write(str(path), clipped, TARGET_SAMPLE_RATE, subtype="PCM_16")
