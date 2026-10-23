"""Audio in and out: any container to mono float32 at a chosen rate, and WAV out.

PyAV rather than an ffmpeg binary: there is none on PATH on this machine, and
the sidecar decodes uploads the same way (`services/local-stt/audio/decode.py`),
so a clip decoded here is the array the sidecar would have decoded.
"""

from __future__ import annotations

import io
from pathlib import Path

import av
import numpy as np
import soundfile as sf
from av.audio.resampler import AudioResampler

TARGET_RATE = 16000


def decode(data: bytes | Path, rate: int = TARGET_RATE) -> np.ndarray:
    """Decode a whole file or payload to mono float32 at `rate`."""
    source = io.BytesIO(data) if isinstance(data, bytes) else str(data)
    chunks: list[np.ndarray] = []
    with av.open(source) as container:
        stream = next(s for s in container.streams if s.type == "audio")
        resampler = AudioResampler(format="fltp", layout="mono", rate=rate)
        for frame in container.decode(stream):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().reshape(-1))
        for out in resampler.resample(None):
            chunks.append(out.to_ndarray().reshape(-1))
    if not chunks:
        raise ValueError(f"{source!r} decoded to zero samples")
    return np.concatenate(chunks).astype(np.float32)


def write_wav(path: Path, samples: np.ndarray, rate: int = TARGET_RATE) -> None:
    """PCM16 mono. Clipped first: float audio slightly over 1.0 would wrap."""
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), np.clip(samples, -1.0, 1.0), rate, subtype="PCM_16")


def read_wav(path: Path) -> np.ndarray:
    samples, rate = sf.read(str(path), dtype="float32")
    if rate != TARGET_RATE or samples.ndim != 1:
        raise ValueError(f"{path}: expected {TARGET_RATE} Hz mono, got {rate} Hz / {samples.shape}")
    return samples
