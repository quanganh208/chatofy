"""Audio loading and CSV artifact writing.

Every bench writes per-turn rows, never only an aggregate — a single accuracy
number hides the failure modes that matter here (a bad duration bucket averaged
away by good ones, or a speaker-count trajectory that is wrong while accuracy
looks fine). One writer lives here so artifact shape cannot drift between benches.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import numpy as np
import soundfile as sf

from .segment import SAMPLE_RATE, WORKLET_BLOCK_SAMPLES, downsample_block_to_pcm16


@dataclass(frozen=True)
class Audio:
    """Mono audio at its source rate, in -1..1 floats."""

    samples: np.ndarray
    sample_rate: int

    @property
    def duration_s(self) -> float:
        return len(self.samples) / self.sample_rate


def load_audio(path: str | Path) -> Audio:
    """Read a mono WAV at its own rate.

    The rate is deliberately NOT normalised on load: production captures at the
    AudioContext's rate and downsamples per block, so the source rate is part of
    what the segmenter models. Use :func:`to_pcm16_16k` when the extractor needs
    16 kHz.
    """
    samples, rate = sf.read(str(path), dtype="float32", always_2d=True)
    if samples.shape[1] != 1:
        # Averaging would invent a mix production never made; the fixture is
        # meant to be mono and a stereo file means something upstream is wrong.
        raise ValueError(f"{path}: expected mono, got {samples.shape[1]} channels")
    return Audio(samples=samples[:, 0].astype(np.float64), sample_rate=int(rate))


def to_pcm16_16k(audio: Audio, *, block_samples: int = WORKLET_BLOCK_SAMPLES) -> np.ndarray:
    """Resample to 16 kHz PCM16 the way the capture path does.

    Block-by-block with a per-block phase reset, matching ``downsampleToPcm16``,
    rather than a one-shot resample of the whole file. The two differ by a
    fraction of a sample per block; using the one-shot version would hand the
    extractor audio production never produces.
    """
    chunks = []
    total = (len(audio.samples) // block_samples) * block_samples
    for start in range(0, total, block_samples):
        block = audio.samples[start : start + block_samples]
        chunks.append(downsample_block_to_pcm16(block, audio.sample_rate))
    if not chunks:
        return np.zeros(0, dtype=np.int16)
    return np.concatenate(chunks)


def pcm16_to_float(samples: np.ndarray) -> np.ndarray:
    """PCM16 to the float32 -1..1 that sherpa-onnx extractors take."""
    return (samples.astype(np.float32) / 0x8000).astype(np.float32)


def write_rows(
    path: str | Path,
    rows: Sequence[Mapping[str, Any]],
    *,
    fieldnames: Iterable[str] | None = None,
) -> Path:
    """Write per-item rows to CSV, creating parent directories.

    Writing an empty result is allowed and produces a HEADER-ONLY file: a bench
    that found nothing must leave evidence that it ran, not an absent file — or a
    blank one — that reads the same as a bench that was never invoked. Writing no
    rows therefore requires ``fieldnames``, since there is nothing to infer them
    from and a headerless blank file is indistinguishable from a corrupted one.
    """
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    if fieldnames is not None:
        names = list(fieldnames)
    elif rows:
        names = list(rows[0].keys())
    else:
        raise ValueError(
            f"{out}: writing zero rows requires explicit fieldnames, or the "
            "artifact is a blank file that cannot be told apart from a corrupt one"
        )
    with out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=names)
        writer.writeheader()
        writer.writerows(rows)
    return out


__all__ = [
    "Audio",
    "SAMPLE_RATE",
    "load_audio",
    "pcm16_to_float",
    "to_pcm16_16k",
    "write_rows",
]
