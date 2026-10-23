"""Whisper's log-mel input, in numpy.

The same computation as transformers' `WhisperFeatureExtractor` numpy path,
which is what the language-identification numbers were measured through: the
audio zero-padded (or cut) to `window` samples, an STFT with a periodic Hann
window centred by reflection, power, Slaney mel filters, log10, the last frame
dropped, then the 8-decade floor and Whisper's (x + 4) / 4 scaling. Written out
rather than imported because transformers is a 50 MB dependency for these
forty lines. `test_lid.py` pins it against values transformers produced.
"""
import numpy as np

RATE = 16000
N_FFT = 400
HOP = 160
N_MELS = 80
#: Whisper's own window: every model was trained on 30 s inputs.
MAX_SAMPLES = 30 * RATE


def _hz_to_mel(freq: np.ndarray) -> np.ndarray:
    """Slaney's mel scale: linear below 1 kHz, logarithmic above."""
    mels = 3.0 * freq / 200.0
    log_region = freq >= 1000.0
    mels[log_region] = 15.0 + np.log(freq[log_region] / 1000.0) * (27.0 / np.log(6.4))
    return mels


def _mel_to_hz(mels: np.ndarray) -> np.ndarray:
    freq = 200.0 * mels / 3.0
    log_region = mels >= 15.0
    freq[log_region] = 1000.0 * np.exp((np.log(6.4) / 27.0) * (mels[log_region] - 15.0))
    return freq


def _mel_filters() -> np.ndarray:
    """[N_MELS, N_FFT // 2 + 1] triangular filters, Slaney area-normalised."""
    fft_freqs = np.linspace(0, RATE // 2, N_FFT // 2 + 1)
    edges = _mel_to_hz(np.linspace(_hz_to_mel(np.array([0.0]))[0], _hz_to_mel(np.array([8000.0]))[0], N_MELS + 2))
    widths = np.diff(edges)
    slopes = edges[None, :] - fft_freqs[:, None]
    down = -slopes[:, :-2] / widths[:-1]
    up = slopes[:, 2:] / widths[1:]
    filters = np.maximum(0.0, np.minimum(down, up))
    filters *= 2.0 / (edges[2 : N_MELS + 2] - edges[:N_MELS])
    return filters.T


_FILTERS = _mel_filters()
_WINDOW = np.hanning(N_FFT + 1)[:-1]


def log_mel(samples: np.ndarray, window: int = MAX_SAMPLES) -> np.ndarray:
    """[1, N_MELS, window // HOP] float32 features of the first `window` samples."""
    audio = np.zeros(window, dtype=np.float64)
    head = samples[:window]
    audio[: len(head)] = head
    padded = np.pad(audio, N_FFT // 2, mode="reflect")
    frames = np.lib.stride_tricks.sliding_window_view(padded, N_FFT)[::HOP]
    # complex64 in between, as transformers stores the spectrum.
    spectrum = np.fft.rfft(frames * _WINDOW, axis=1).astype(np.complex64)
    power = np.abs(spectrum, dtype=np.float64) ** 2
    mel = np.log10(np.maximum(1e-10, _FILTERS @ power.T)).astype(np.float32)[:, :-1]
    mel = np.maximum(mel, mel.max() - 8.0)
    return ((mel + 4.0) / 4.0)[None, :, :]
