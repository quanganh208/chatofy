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

**The bounded-speaker arm.** ``k_max`` caps how many speakers may ever be
created. It is the one lever that makes over-split arithmetically impossible
rather than statistically unlikely, and over-split is the only bar the cold
session run actually fails. It is off by default, because what happens *above*
the cap is an open question with three candidate answers and no measurement
behind any of them yet — see :class:`OnlineAttributor` and ``above_cap``.

Every parameter added for that arm defaults to the behaviour this module had
before it existed, so an unparameterised ``OnlineAttributor`` is byte-identical
to the one every published number was measured on.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field

import numpy as np

#: What to do with a turn that would have started a new speaker when the cap is
#: already full. There is no default-correct answer; each buys something at a
#: price, and the session bench prices them.
#:
#: ``assign``
#:     Fold it into the nearest existing speaker and label it. Nothing is ever
#:     silent, and the error is invisible: the chip count stays right while the
#:     name is wrong. The guest probe measured this at a 64.9% theft rate.
#: ``abstain``
#:     Leave it undecided. The turn renders nothing, which is honest but costs
#:     a label on every turn a genuinely-new speaker contributes.
#: ``raise_tau``
#:     Keep assigning, but only on strong matches — ``tau_assign_capped``
#:     replaces ``tau_assign`` once the cap binds. The middle point, and the
#:     only one with a tunable knob.
ABOVE_CAP_POLICIES = ("assign", "abstain", "raise_tau")


@dataclass(frozen=True)
class Assignment:
    """What the attributor decided about one turn.

    ``label`` is ``None`` exactly when the turn produced no speaker — the dead
    zone, a suppressed above-cap turn, or a turn still corroborating a
    provisional speaker. ``score`` is the best cosine against any existing
    centroid, or ``-inf`` for the very first turn, when there is nothing to
    compare against.
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

    A windowed cluster keeps its member vectors instead, because a sliding
    window has to subtract as well as add and a running sum cannot forget.
    """

    total: np.ndarray
    turns: int = 1
    recent: deque | None = None

    @property
    def centroid(self) -> np.ndarray:
        norm = float(np.linalg.norm(self.total))
        return (self.total / norm).astype(np.float32)

    def fold(self, vector: np.ndarray, *, cap: int | None, window: int | None = None) -> None:
        """Absorb one turn.

        ``cap`` **freezes**: past it, the centroid stops moving entirely and is
        whatever the first ``cap`` turns made it. ``window`` **tracks**: it holds
        the last ``window`` turns and forgets older ones. These are opposite
        behaviours and the module docstring's claim that a bounded centroid
        "keeps tracking" is only true of the second. They are measured as
        separate arms; ``window`` wins when both are set, since freezing a
        window is not a thing anyone would want.
        """
        if window is not None:
            if self.recent is None:
                self.recent = deque([self.total.copy()], maxlen=window)
            self.recent.append(np.asarray(vector, dtype=np.float32))
            self.total = np.sum(self.recent, axis=0).astype(np.float32)
            self.turns += 1
            return
        if cap is not None and self.turns >= cap:
            return
        self.total = self.total + vector
        self.turns += 1


@dataclass
class OnlineAttributor:
    """Assign turns to speakers as they arrive, discovering speakers as it goes.

    ``tau_assign`` is the bar to join an existing speaker; ``tau_new`` is the bar
    below which a turn is declared a new speaker. Between them is the dead zone.

    ``centroid_cap`` bounds how many turns a centroid averages, by **freezing**
    it once that many have landed. ``centroid_window`` instead keeps the last N
    turns, which is what actually tracks a drifting voice. Unbounded, a speaker
    who talks for an hour ends up with a centroid that later evidence cannot
    move. Which of the three is right is an empirical question the session bench
    answers; ``None`` for both means unbounded and is the baseline to beat.

    ``k_max`` caps the number of speakers that may ever be created. Below the
    cap nothing changes. **At the cap, only creation is blocked** — the assign
    branch runs first and is untouched — so a turn from an unmodelled speaker
    does not fall silent unless ``above_cap`` says it should. That asymmetry is
    the whole reason ``above_cap`` exists rather than being assumed.

    ``mint_confirmations`` defers minting: above 1, a turn that would start a
    new speaker instead opens a **provisional** cluster which carries no label
    and renders nothing, and becomes a real speaker only once that many turns
    have independently corroborated it. **That includes the very first turn of
    the session** — the module's usual guarantee that turn one always creates
    cluster 0 holds only at ``mint_confirmations == 1``, which is the default
    and the setting every published number was measured at. Deferral trades the
    first turn of every speaker for protection against a one-off turn becoming
    a permanent ordinal, and M5 is what prices that trade.
    """

    tau_assign: float
    tau_new: float
    centroid_cap: int | None = None
    centroid_window: int | None = None
    k_max: int | None = None
    above_cap: str = "assign"
    tau_assign_capped: float | None = None
    mint_confirmations: int = 1
    _clusters: list[_Cluster] = field(default_factory=list, init=False, repr=False)
    _provisional: list[_Cluster] = field(default_factory=list, init=False, repr=False)

    def __post_init__(self) -> None:
        if self.tau_new > self.tau_assign:
            raise ValueError(
                f"tau_new ({self.tau_new}) above tau_assign ({self.tau_assign}) inverts the "
                "dead zone: turns would both start a new speaker and join an existing one"
            )
        if self.k_max is not None and self.k_max < 1:
            raise ValueError(f"k_max ({self.k_max}) must allow at least one speaker")
        if self.above_cap not in ABOVE_CAP_POLICIES:
            raise ValueError(
                f"above_cap ({self.above_cap!r}) is not one of {ABOVE_CAP_POLICIES}"
            )
        if self.above_cap == "raise_tau":
            if self.tau_assign_capped is None:
                raise ValueError(
                    "above_cap='raise_tau' needs tau_assign_capped: the policy IS the "
                    "raised bar, so leaving it unset would silently run policy 'assign'"
                )
            if self.tau_assign_capped < self.tau_assign:
                raise ValueError(
                    f"tau_assign_capped ({self.tau_assign_capped}) below tau_assign "
                    f"({self.tau_assign}) would LOOSEN the bar above the cap"
                )
        if self.mint_confirmations < 1:
            raise ValueError(
                f"mint_confirmations ({self.mint_confirmations}) must be at least 1; "
                "1 means no deferral"
            )

    @property
    def speakers(self) -> int:
        """Confirmed speakers. Provisional clusters are deliberately not counted.

        They carry no ordinal and render nothing, so counting them here would
        report a speaker the user cannot see — and this property is what the
        count error is computed from.
        """
        return len(self._clusters)

    @property
    def provisional(self) -> int:
        return len(self._provisional)

    @property
    def centroids(self) -> list[np.ndarray]:
        return [cluster.centroid for cluster in self._clusters]

    @property
    def cap_bound(self) -> bool:
        """True once no further speaker may be created."""
        return self.k_max is not None and len(self._clusters) >= self.k_max

    def seed(self, vector: np.ndarray) -> int:
        """Pre-register a known speaker — the optional enrolment path.

        Accepts an already-averaged enrolment vector, so a caller that recorded
        several enrolment clips averages them itself and hands over one centroid.

        Seeding ignores ``k_max``: a caller naming N known speakers has better
        information than any cap, and refusing the seed would silently measure a
        different meeting than the one asked for.
        """
        return self._create(vector)

    def observe(self, vector: np.ndarray) -> Assignment:
        vector = np.asarray(vector, dtype=np.float32)
        if not self._clusters:
            if self.cap_bound:
                # k_max=0 is rejected in __post_init__, so this is only
                # reachable if every cluster was somehow removed. Abstain
                # rather than create past a cap that is already full.
                return Assignment(label=None, created=False, score=-math.inf)
            return self._open(vector, score=-math.inf)

        scores = np.stack([cluster.centroid for cluster in self._clusters]) @ vector
        best = int(np.argmax(scores))
        best_score = float(scores[best])

        assign_bar = self.tau_assign
        if self.cap_bound and self.above_cap == "raise_tau":
            assign_bar = float(self.tau_assign_capped)

        if best_score >= assign_bar:
            self._assign(best, vector)
            return Assignment(label=best, created=False, score=best_score)

        if best_score < self.tau_new:
            if not self.cap_bound:
                return self._open(vector, score=best_score)
            if self.above_cap == "assign":
                # The cap forbids a new speaker but not a wrong one. This is the
                # arm that keeps the chip count right and puts the wrong name on
                # the turn — measured, not assumed, before it is ever chosen.
                self._assign(best, vector)
                return Assignment(label=best, created=False, score=best_score)
            return Assignment(label=None, created=False, score=best_score)

        return Assignment(label=None, created=False, score=best_score)

    def _assign(self, index: int, vector: np.ndarray) -> None:
        self._clusters[index].fold(
            vector, cap=self.centroid_cap, window=self.centroid_window
        )

    def _open(self, vector: np.ndarray, *, score: float) -> Assignment:
        """Start a speaker, or the deferred-mint path toward one.

        With ``mint_confirmations == 1`` this is a plain create and the deferral
        machinery never runs, which is what keeps the default identical to the
        original implementation.
        """
        if self.mint_confirmations <= 1:
            return Assignment(label=self._create(vector), created=True, score=score)

        if self._provisional:
            candidates = np.stack([cluster.centroid for cluster in self._provisional])
            best = int(np.argmax(candidates @ vector))
            if float((candidates @ vector)[best]) >= self.tau_assign:
                cluster = self._provisional[best]
                cluster.fold(vector, cap=self.centroid_cap, window=self.centroid_window)
                if cluster.turns >= self.mint_confirmations and not self.cap_bound:
                    self._provisional.pop(best)
                    self._clusters.append(cluster)
                    return Assignment(
                        label=len(self._clusters) - 1, created=True, score=score
                    )
                return Assignment(label=None, created=False, score=score)

        self._provisional.append(_Cluster(total=vector.copy()))
        return Assignment(label=None, created=False, score=score)

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
        """Signed: positive is over-split, negative is merge.

        The sign is the whole information. Over-split shows one person under two
        names — visible, and the user can see it is wrong. A merge shows two
        people under one name — invisible, and in a translation app it puts the
        counterpart's words in the user's mouth. The repairs are opposite, so
        anything that takes ``abs()`` of this has thrown away which repair to
        reach for.
        """
        return self.clusters - self.true_speakers

    @property
    def exact_count(self) -> bool:
        return self.speaker_count_error == 0


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

    **This is an upper bound, not a product number.** ``linear_sum_assignment``
    runs after seeing ground truth and picks the correspondence that maximises
    hits; the product never has ground truth. Choosing *which* cluster is
    ordinal 1 is legitimate — the numbering asserts no identity — but choosing
    it with an oracle is not. :func:`speaker_bench.scoring.score_prefix_locked`
    is the same meeting scored without the oracle, and the gap between the two
    is how much of this number the product cannot have.
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
