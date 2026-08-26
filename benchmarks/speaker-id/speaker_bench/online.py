"""Online speaker attribution with an unknown number of speakers.

This is the algorithm the product would actually run, and it is **not** what
Checkpoint 1 measured. The screen compared turn against turn; this compares a
turn against an accumulated centroid. The enrolment probe showed the gap between
those two is enormous — 23.0% EER turn-to-turn, versus 88.3% accuracy against a
centroid built from ~15s — so the distinction is the whole design, not a detail.

**Where the centroid comes from is a product decision, not an algorithmic one.**
Seeded from a named enrolment, it starts strong. Seeded from nothing, the first
turn of each speaker is a one-element centroid sitting squarely in the bad
regime, and it improves as that speaker keeps talking. Both are the same code
path here; :meth:`OnlineAttributor.seed` is the only difference. That is what
makes enrolment optional rather than load-bearing.

**Three outcomes per turn, not two.** A turn is assigned, or it starts a new
speaker, or it is left undecided. The dead zone between the thresholds exists
because the alternative — forcing every turn into the nearest cluster — silently
poisons centroids with wrong audio, and a poisoned centroid keeps being wrong
for every later turn. Undecided turns are therefore never folded into a
centroid; they cost coverage instead, and coverage is a reportable number
whereas a corrupted centroid is not.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np


@dataclass(frozen=True)
class Assignment:
    """What the attributor decided about one turn.

    ``label`` is ``None`` exactly when the turn fell in the dead zone. ``score``
    is the best cosine against any existing centroid, or ``-inf`` for the very
    first turn, when there is nothing to compare against.
    """

    label: int | None
    created: bool
    score: float

    @property
    def undecided(self) -> bool:
        return self.label is None


@dataclass
class _Cluster:
    """A running centroid.

    The sum is kept rather than the mean so that folding in a turn is exact and
    order-independent; the centroid is the normalised sum, recomputed on read.
    """

    total: np.ndarray
    turns: int = 1

    @property
    def centroid(self) -> np.ndarray:
        norm = float(np.linalg.norm(self.total))
        return (self.total / norm).astype(np.float32)

    def fold(self, vector: np.ndarray, *, cap: int | None) -> None:
        if cap is not None and self.turns >= cap:
            return
        self.total = self.total + vector
        self.turns += 1


@dataclass
class OnlineAttributor:
    """Assign turns to speakers as they arrive, discovering speakers as it goes.

    ``tau_assign`` is the bar to join an existing speaker; ``tau_new`` is the bar
    below which a turn is declared a new speaker. Between them is the dead zone.

    ``centroid_cap`` bounds how many turns a centroid averages. Unbounded, a
    speaker who talks for an hour ends up with a centroid that later evidence
    cannot move — which is the wrong behaviour if their voice drifts, if they
    change position in the room, or if a wrong turn ever got in. Bounded, the
    centroid keeps tracking. The right value is an empirical question the session
    bench answers; ``None`` means unbounded and is the baseline to beat.
    """

    tau_assign: float
    tau_new: float
    centroid_cap: int | None = None
    _clusters: list[_Cluster] = field(default_factory=list, init=False, repr=False)

    def __post_init__(self) -> None:
        if self.tau_new > self.tau_assign:
            raise ValueError(
                f"tau_new ({self.tau_new}) above tau_assign ({self.tau_assign}) inverts the "
                "dead zone: turns would both start a new speaker and join an existing one"
            )

    @property
    def speakers(self) -> int:
        return len(self._clusters)

    @property
    def centroids(self) -> list[np.ndarray]:
        return [cluster.centroid for cluster in self._clusters]

    def seed(self, vector: np.ndarray) -> int:
        """Pre-register a known speaker — the optional enrolment path.

        Accepts an already-averaged enrolment vector, so a caller that recorded
        several enrolment clips averages them itself and hands over one centroid.
        """
        return self._create(vector)

    def observe(self, vector: np.ndarray) -> Assignment:
        if not self._clusters:
            return Assignment(label=self._create(vector), created=True, score=-math.inf)

        scores = np.stack([cluster.centroid for cluster in self._clusters]) @ vector
        best = int(np.argmax(scores))
        best_score = float(scores[best])

        if best_score >= self.tau_assign:
            self._clusters[best].fold(vector, cap=self.centroid_cap)
            return Assignment(label=best, created=False, score=best_score)
        if best_score < self.tau_new:
            return Assignment(label=self._create(vector), created=True, score=best_score)
        return Assignment(label=None, created=False, score=best_score)

    def _create(self, vector: np.ndarray) -> int:
        self._clusters.append(_Cluster(total=np.asarray(vector, dtype=np.float32).copy()))
        return len(self._clusters) - 1


@dataclass(frozen=True)
class SessionScore:
    """How one simulated meeting went."""

    attributed: int
    total: int
    correct: int
    clusters: int
    true_speakers: int

    @property
    def coverage(self) -> float:
        return 0.0 if self.total == 0 else self.attributed / self.total

    @property
    def accuracy(self) -> float:
        """Accuracy over ATTRIBUTED turns — the plan's acceptance shape.

        Deliberately not accuracy over all turns: an undecided turn is a
        different product failure from a mislabelled one (a missing name versus
        a wrong name), and averaging them into one number hides which is
        happening. Coverage carries the other half.
        """
        return 0.0 if self.attributed == 0 else self.correct / self.attributed

    @property
    def speaker_count_error(self) -> int:
        return self.clusters - self.true_speakers


def score_session(truth: list[str], assignments: list[Assignment]) -> SessionScore:
    """Score one meeting, mapping cluster ids onto speakers optimally.

    Cluster ids are arbitrary — the attributor never learns anyone's name — so
    scoring must find the best correspondence between clusters and speakers
    before counting hits. Anything less (say, majority vote per cluster) can
    assign two clusters to one speaker and overcount.

    Splitting one speaker across two clusters is still penalised, because the
    assignment is one-to-one: the second cluster's turns cannot be credited.
    That is the correct penalty — in the product, one person appearing as two
    labels is a visible failure.
    """
    if len(truth) != len(assignments):
        raise ValueError(f"{len(truth)} turns but {len(assignments)} assignments")

    from scipy.optimize import linear_sum_assignment

    speakers = sorted(set(truth))
    speaker_index = {name: i for i, name in enumerate(speakers)}
    clusters = sorted({a.label for a in assignments if a.label is not None})
    cluster_index = {label: i for i, label in enumerate(clusters)}

    attributed = sum(1 for a in assignments if a.label is not None)
    if not clusters:
        return SessionScore(0, len(truth), 0, 0, len(speakers))

    contingency = np.zeros((len(clusters), len(speakers)), dtype=np.int64)
    for name, assignment in zip(truth, assignments):
        if assignment.label is not None:
            contingency[cluster_index[assignment.label], speaker_index[name]] += 1

    rows, columns = linear_sum_assignment(-contingency)
    correct = int(contingency[rows, columns].sum())
    return SessionScore(
        attributed=attributed,
        total=len(truth),
        correct=correct,
        clusters=len(clusters),
        true_speakers=len(speakers),
    )
