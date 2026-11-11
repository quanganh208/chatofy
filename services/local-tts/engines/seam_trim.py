"""Shorter silence where the sidecar itself cut a clause.

Every Kokoro `generate` call pads its audio: about 95 ms of silence before
the speech and about 150 ms after it (measured 11/11/2026). Between two
clauses the speaker punctuated, that pause is right. Between two pieces of
one clause that `cap_first_clause` cut apart, 245 ms of silence is what makes
the cut sound like a sentence end, so those seams keep only a short breath.

Trimming is by energy, scanning in from the edge, so no sample that is part
of a word is ever removed, and the new edge is faded to avoid a click.
"""
import numpy as np

#: Below this absolute amplitude a sample counts as silence.
SILENCE_THRESHOLD = 0.01
#: Silence kept after the last word of a piece followed by a cut.
KEEP_TAIL_MS = 50
#: Silence kept before the first word of a piece that follows a cut.
KEEP_LEAD_MS = 30
#: Fade over the new edge, so the cut point does not click.
FADE_MS = 5


def _fade(n: int) -> np.ndarray:
    return np.linspace(1.0, 0.0, n, dtype=np.float32)


def trim_tail(samples: np.ndarray, rate: int, keep_ms: int = KEEP_TAIL_MS) -> np.ndarray:
    """`samples` with trailing silence cut to `keep_ms`; untouched if all silent."""
    loud = np.nonzero(np.abs(samples) > SILENCE_THRESHOLD)[0]
    if not len(loud):
        return samples
    end = min(len(samples), loud[-1] + 1 + rate * keep_ms // 1000)
    if end == len(samples):
        return samples
    out = samples[:end].copy()
    n = min(rate * FADE_MS // 1000, end - (loud[-1] + 1))
    if n > 0:
        out[-n:] *= _fade(n)
    return out


def trim_lead(samples: np.ndarray, rate: int, keep_ms: int = KEEP_LEAD_MS) -> np.ndarray:
    """`samples` with leading silence cut to `keep_ms`; untouched if all silent."""
    loud = np.nonzero(np.abs(samples) > SILENCE_THRESHOLD)[0]
    if not len(loud):
        return samples
    start = max(0, loud[0] - rate * keep_ms // 1000)
    if start == 0:
        return samples
    out = samples[start:].copy()
    n = min(rate * FADE_MS // 1000, loud[0] - start)
    if n > 0:
        out[:n] *= _fade(n)[::-1]
    return out
