"""Bring any corpus clip to the shape a gate-cut turn has before it is measured.

Shared by every prepare script, so FLEURS, conversational corpora and
re-recorded audio all reach the arms at the same level, with the same onset,
under the same ceiling.
"""

from __future__ import annotations

import numpy as np

from lid_bench.audio import TARGET_RATE

CEILING_S = 8.0
#: Level every public clip is brought to (RMS, about -20 dBFS). FLEURS mixes
#: studio-level clips with ones near -60 dBFS, and the speech measure the
#: buckets use is calibrated on browser capture, which has auto-gain on: at their
#: native level a quarter of the en clips measured 0 ms of speech. Normalising to
#: a capture-like level is what the client's AGC would have done before the
#: sidecar ever saw them.
TARGET_RMS = 0.1
#: The client's pre-roll (`PRE_ROLL_MS` in capture-pump.ts). A gate-cut turn
#: starts this long before speech; FLEURS clips start ~1 s before it, which made
#: every early prefix mostly silence and measured the corpus, not the arm.
PRE_ROLL_MS = 320
ONSET_FRAME_MS = 20
#: Speech level for the onset: the gate's minimum floor plus its margin
#: (speech-gate.ts MIN_NOISE_FLOOR + SPEECH_MARGIN), on the normalised clip.
ONSET_LEVEL = 0.004 + 0.018


def trim_to_pre_roll(samples: np.ndarray) -> np.ndarray:
    """Drop leading silence down to PRE_ROLL_MS before the first speech frame."""
    frame = TARGET_RATE * ONSET_FRAME_MS // 1000
    usable = samples.size - samples.size % frame
    if usable == 0:
        return samples
    levels = np.sqrt(np.square(samples[:usable].reshape(-1, frame)).mean(axis=1))
    loud = np.nonzero(levels > ONSET_LEVEL)[0]
    if loud.size == 0:
        return samples
    start = max(0, int(loud[0]) * frame - TARGET_RATE * PRE_ROLL_MS // 1000)
    return samples[start:]


def prepare_clip(samples: np.ndarray, *, speech: bool = True) -> np.ndarray:
    """Normalise to TARGET_RMS (peak-limited), trim the onset of a speech clip
    to the pre-roll, and cut at the client's ceiling."""
    rms = float(np.sqrt(np.mean(samples**2))) if samples.size else 0.0
    if rms > 0:
        samples = samples * (TARGET_RMS / rms)
        peak = float(np.abs(samples).max())
        if peak > 0.99:
            samples = samples * (0.99 / peak)
    # Trimmed for speech only: a noise clip has no onset to align.
    if speech:
        samples = trim_to_pre_roll(samples)
    return samples[: int(CEILING_S * TARGET_RATE)]
