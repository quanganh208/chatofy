"""Trial lists, EER, and duration buckets.

Three phases read this module: Phase 3 computes an EER to decide the model,
Phase 4 re-uses the same threshold sweep to calibrate tau, and Phase 7 compares
two EERs across audio channels. One implementation, tested on its own, rather
than three copies of a threshold sweep drifting apart inside three bench scripts.

The EER here is the number Checkpoint 1 reads. It is verified against the
analytic value for two Gaussians of known separation rather than against a
hand-picked expected output, because an EER routine that is subtly wrong still
returns a plausible-looking percentage and nothing downstream would notice.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator, Sequence

import numpy as np

#: Duration buckets the gate reports separately, in seconds.
#:
#: Never pooled. A catastrophic 1s bucket averaged together with healthy 3s
#: turns reads as an acceptable overall number while the product fails on
#: exactly the turns that are hardest and most common.
DURATION_BUCKETS_S: tuple[float, ...] = (1.0, 2.0, 3.0)

#: Turns shorter than this are dropped rather than padded.
#:
#: Padding to reach a bucket would hand the extractor silence and let it be
#: scored as if it were speech, which inflates every number derived from it.
MIN_BUCKET_S = 0.5


@dataclass(frozen=True)
class Trial:
    """One line of a verification trial list.

    ``same`` is the ground truth: True when both sides are the same speaker.
    Paths are kept as written in the list, relative to the corpus root, so a
    trial list stays portable across machines.
    """

    same: bool
    path_a: str
    path_b: str


def parse_trial_line(line: str) -> Trial | None:
    """Parse one ``label path_a path_b`` line, or None for a blank/comment.

    This is the VoxCeleb convention that Vietnam-Celeb and VoxVietnam both
    follow: ``1`` for a same-speaker (target) pair, ``0`` for different.
    """
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    fields = stripped.split()
    if len(fields) != 3:
        raise ValueError(
            f"trial line must be 'label path_a path_b', got {len(fields)} "
            f"field(s): {stripped!r}"
        )
    label, path_a, path_b = fields
    if label not in ("0", "1"):
        raise ValueError(f"trial label must be '0' or '1', got {label!r} in {stripped!r}")
    return Trial(same=label == "1", path_a=path_a, path_b=path_b)


def load_trials(path: str | Path) -> list[Trial]:
    """Read a trial list, raising on the first malformed line.

    Loud rather than lenient: a trial list that silently drops a tenth of its
    lines still produces an EER, and the EER would be over a set nobody chose.
    """
    out: list[Trial] = []
    with Path(path).open(encoding="utf-8") as handle:
        for number, line in enumerate(handle, start=1):
            try:
                trial = parse_trial_line(line)
            except ValueError as exc:
                raise ValueError(f"{path}:{number}: {exc}") from exc
            if trial is not None:
                out.append(trial)
    if not out:
        raise ValueError(f"{path}: no trials found")
    return out


@dataclass(frozen=True)
class EerResult:
    """An EER and the threshold that achieves it.

    ``far`` and ``frr`` are the two error rates at that threshold. They are kept
    because they are not exactly equal on discrete data — the crossing usually
    falls between two samples — and reporting the pair makes the interpolation
    visible instead of implied.
    """

    eer: float
    threshold: float
    far: float
    frr: float
    n_target: int
    n_nontarget: int


def compute_eer(
    target_scores: Sequence[float] | np.ndarray,
    nontarget_scores: Sequence[float] | np.ndarray,
) -> EerResult:
    """Equal error rate over similarity scores, higher score = more similar.

    Sweeps every observed score as a threshold and interpolates at the crossing
    where the false-accept rate meets the false-reject rate.

    Convention: a trial is accepted when ``score >= threshold``. So FAR is the
    fraction of non-target pairs at or above it, and FRR the fraction of target
    pairs below it.
    """
    target = np.asarray(target_scores, dtype=np.float64).ravel()
    nontarget = np.asarray(nontarget_scores, dtype=np.float64).ravel()
    if target.size == 0 or nontarget.size == 0:
        raise ValueError(
            "EER needs both target and non-target scores; got "
            f"{target.size} target and {nontarget.size} non-target"
        )

    # Candidate thresholds are the DISTINCT observed scores.
    #
    # Correctness comes from evaluating each threshold by VALUE below, via
    # searchsorted, rather than by position in a per-sample sweep. A positional
    # sweep treats tied scores as orderable — it would accept one pair scoring
    # 0.5 while rejecting another scoring 0.5 — and so credits itself with
    # separation the scores do not contain. That was a real bug here, caught by
    # the all-equal case, and the by-value form is what fixes it.
    #
    # Given that, `unique` is a speed optimisation (about 2x on tied data), not
    # the fix: duplicated thresholds would produce duplicated identical rows and
    # the same answer. The tie invariants in the tests guard the by-value
    # property, which is the one that matters.
    thresholds = np.unique(np.concatenate([target, nontarget]))
    # Sentinel just above the maximum, meaning "reject everything": frr 1, far 0.
    # Without it a fully-tied input has no bracket containing the crossing.
    thresholds = np.append(thresholds, np.nextafter(thresholds[-1], np.inf))

    target_sorted = np.sort(target)
    nontarget_sorted = np.sort(nontarget)
    # Accept when score >= threshold. So FRR counts targets strictly below it,
    # and FAR counts non-targets at or above it.
    frr = np.searchsorted(target_sorted, thresholds, side="left") / target.size
    far = (
        nontarget.size - np.searchsorted(nontarget_sorted, thresholds, side="left")
    ) / nontarget.size

    # frr rises and far falls as the threshold rises, so their difference is
    # non-decreasing: -1 at the lowest threshold, +1 at the sentinel. A crossing
    # therefore always exists strictly inside, and always has a bracket.
    difference = frr - far
    crossing = int(np.argmax(difference >= 0))
    assert crossing > 0, "difference starts at -1 by construction"

    scores = thresholds
    lo, hi = crossing - 1, crossing
    # Linear interpolation of the crossing between the two bracketing samples.
    span = (frr[hi] - far[hi]) - (frr[lo] - far[lo])
    weight = 0.0 if span == 0 else (0.0 - (frr[lo] - far[lo])) / span
    eer = float(frr[lo] + weight * (frr[hi] - frr[lo]))
    threshold = float(scores[lo] + weight * (scores[hi] - scores[lo]))
    return EerResult(
        eer=eer,
        threshold=threshold,
        far=float(far[lo] + weight * (far[hi] - far[lo])),
        frr=float(frr[lo] + weight * (frr[hi] - frr[lo])),
        n_target=int(target.size),
        n_nontarget=int(nontarget.size),
    )


def bucket_for(duration_s: float, buckets: Iterable[float] = DURATION_BUCKETS_S) -> float | None:
    """Largest bucket a clip of this duration can fill, or None if too short.

    A 2.7s clip belongs to the 2s bucket, not the 3s one: it is truncated to the
    bucket length, and truncating to something longer than the audio would mean
    padding. Clips under :data:`MIN_BUCKET_S` are dropped entirely.
    """
    if duration_s < MIN_BUCKET_S:
        return None
    eligible = [bucket for bucket in buckets if bucket <= duration_s]
    if not eligible:
        return None
    return max(eligible)


def truncate_to(samples: np.ndarray, seconds: float, sample_rate: int) -> np.ndarray:
    """Take the leading ``seconds`` of audio, never padding to reach it.

    Raises when the clip is shorter than requested. Padding would hand the
    extractor silence scored as speech; returning a short clip would put a
    different duration into a bucket that claims to hold one length.
    """
    wanted = int(round(seconds * sample_rate))
    if len(samples) < wanted:
        raise ValueError(
            f"cannot truncate {len(samples) / sample_rate:.3f}s of audio to "
            f"{seconds}s — padding would score silence as speech"
        )
    return samples[:wanted]


def iter_scored(
    trials: Sequence[Trial], scores: Sequence[float]
) -> Iterator[tuple[Trial, float]]:
    """Zip trials with their scores, refusing a length mismatch.

    ``zip`` would silently truncate to the shorter of the two, which turns a
    dropped-embedding bug into a smaller but perfectly plausible EER.
    """
    if len(trials) != len(scores):
        raise ValueError(f"{len(trials)} trials but {len(scores)} scores")
    return zip(trials, scores)


def split_scores(
    trials: Sequence[Trial], scores: Sequence[float]
) -> tuple[np.ndarray, np.ndarray]:
    """Split scores into (target, non-target) by each trial's ground truth."""
    target: list[float] = []
    nontarget: list[float] = []
    for trial, score in iter_scored(trials, scores):
        (target if trial.same else nontarget).append(score)
    return np.asarray(target, dtype=np.float64), np.asarray(nontarget, dtype=np.float64)


__all__ = [
    "DURATION_BUCKETS_S",
    "MIN_BUCKET_S",
    "EerResult",
    "Trial",
    "bucket_for",
    "compute_eer",
    "iter_scored",
    "load_trials",
    "parse_trial_line",
    "split_scores",
    "truncate_to",
]
