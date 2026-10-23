"""NeMo's AudioToMelSpectrogramPreprocessor, in numpy, from its exported tensors.

The steps of `FilterbankFeatures.forward` at inference: pre-emphasis; centred
STFT with reflect padding (`torch.stft`'s default `pad_mode`; zero padding
shifts the first and last frames by up to 2 normalised units) through the
exported window; magnitude raised to `mag_power`; the exported mel filterbank;
`log(x + guard)`; per-feature normalisation over the valid frames (unbiased
std, + 1e-5).

NeMo then right-pads the frame axis to a multiple of `pad_to`; this frontend
does not. The export turns off AmberNet's masked convolutions, so the ONNX
graph lets padded frames into the pooled embedding: fed NeMo's own padded
features it is off by up to 6 logits on a short clip, fed the valid frames
alone it matches NeMo's forward to 1e-5.

Nothing is re-derived (no librosa mel, no window formula): the filterbank and
window ARE NeMo's, which leaves only arithmetic to disagree on -- and
`parity.py` measures that disagreement against NeMo itself.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

NORM_EPS = 1e-5


class Frontend:
    def __init__(self, npz: Path) -> None:
        data = np.load(npz)
        self.fb = data["filterbank"].astype(np.float64)
        self.window = data["window"].astype(np.float64)
        self.n_fft = int(data["n_fft"])
        self.hop = int(data["hop_length"])
        self.win = int(data["win_length"])
        self.preemph = float(data["preemph"])
        self.guard = float(data["log_zero_guard"])
        self.mag_power = float(data["mag_power"])
        self.normalize = str(data["normalize"])

    def __call__(self, samples: np.ndarray) -> tuple[np.ndarray, int]:
        x = samples.astype(np.float64)
        if self.preemph:
            x = np.concatenate([x[:1], x[1:] - self.preemph * x[:-1]])
        valid = len(x) // self.hop + 1
        x = np.pad(x, (self.n_fft // 2, self.n_fft // 2), mode="reflect")
        window = np.zeros(self.n_fft)
        offset = (self.n_fft - self.win) // 2
        window[offset: offset + self.win] = self.window
        frames = 1 + (len(x) - self.n_fft) // self.hop
        idx = np.arange(self.n_fft)[None, :] + self.hop * np.arange(frames)[:, None]
        spectrum = np.abs(np.fft.rfft(x[idx] * window, n=self.n_fft, axis=1))
        if self.mag_power != 1.0:
            spectrum = spectrum ** self.mag_power
        mel = np.log(self.fb @ spectrum.T + self.guard)  # (features, frames)
        if self.normalize == "per_feature":
            used = mel[:, :valid]
            mean = used.mean(axis=1, keepdims=True)
            std = used.std(axis=1, ddof=1, keepdims=True) + NORM_EPS
            mel = (mel - mean) / std
        return mel[:, :valid].astype(np.float32), valid
