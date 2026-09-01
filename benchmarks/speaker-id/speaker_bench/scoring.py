"""Scoring that does not borrow the oracle, and count metrics that keep the sign.

Two things the existing :func:`speaker_bench.online.score_session` cannot do,
both of which the session run needs before its numbers mean what they are read
to mean.

**The oracle.** ``score_session`` calls ``linear_sum_assignment`` on the
cluster x speaker contingency table after seeing ground truth. That does two
separable jobs: it chooses which cluster is ordinal 1, and it chooses the
correspondence that maximises hits. The first is legitimate — an anonymous
ordinal asserts no identity, and the product numbers its speakers in creation
order anyway. The second is not: the product never has ground truth, live or
offline. So every published accuracy is an upper bound, and nobody has ever
computed how loose a bound. :func:`score_prefix_locked` computes the same
meeting with the correspondence fixed causally, at creation, never revised. The
gap between the two IS the oracle, as a number.

**The sign.** ``run_session.aggregate`` takes ``abs()`` of the count error, so
the run cannot distinguish a meeting rendered as too many people from one
rendered as too few. Those are opposite failures with opposite repairs: an
over-split shows one person under two names, which the user can see and correct;
a merge shows two people under one name, which in a translation app silently
attributes the counterpart's words to the user. And at N=2 the absolute bar is
degenerate — a session that collapses both people into one cluster scores
``|dN| = 1`` and passes a ``<= 1.0`` cap. :class:`CountMetrics` keeps the sign
and reports the exact-count rate, which has no such hole.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from speaker_bench.online import Assignment, SessionScore


def score_prefix_locked(
    truth: list[str],
    assignments: list[Assignment],
    *,
    seeded: list[str] | None = None,
) -> SessionScore:
    """Score one meeting with the cluster -> speaker correspondence locked at creation.

    The rule is causal and has no lookahead: the first turn to create a cluster
    fixes what that cluster means, and nothing later revises it. A warm meeting
    passes ``seeded`` — the speakers its centroids were seeded from, in seed
    order — because those clusters were fixed before any turn arrived.

    **One-to-one is preserved.** If a second cluster locks onto a speaker some
    earlier cluster already claimed, it earns no credit: its turns count as
    attributed and wrong. That is the same discipline ``score_session``'s
    assignment imposes, and without it an over-split would score BETTER here
    than under the oracle, which would make the gap meaningless in the one
    regime the cold run actually fails.
    """
    if len(truth) != len(assignments):
        raise ValueError(f"{len(truth)} turns but {len(assignments)} assignments")

    locked: dict[int, str] = {}
    claimed: set[str] = set()

    for index, name in enumerate(seeded or []):
        locked[index] = name
        claimed.add(name)

    for name, assignment in zip(truth, assignments):
        if assignment.label is None or not assignment.created:
            continue
        if assignment.label in locked:
            continue
        # A speaker already claimed by an earlier cluster cannot be claimed
        # again; the cluster stays in `locked` with a sentinel so it is not
        # reconsidered, and earns nothing.
        locked[assignment.label] = name if name not in claimed else None
        claimed.add(name)

    attributed = 0
    correct = 0
    for name, assignment in zip(truth, assignments):
        if assignment.label is None:
            continue
        attributed += 1
        correct += int(locked.get(assignment.label) == name)

    # Counted the same way `score_session` counts: clusters that received a
    # turn. A seeded cluster nobody spoke into is not a chip on screen, and
    # counting it here would make the two scorers' count errors incomparable —
    # which is the one number the whole comparison exists to line up.
    clusters = len({a.label for a in assignments if a.label is not None})
    return SessionScore(
        attributed=attributed,
        total=len(truth),
        correct=correct,
        clusters=clusters,
        true_speakers=len(set(truth)),
    )


@dataclass(frozen=True)
class CountMetrics:
    """How the speaker count went, with the sign kept and the hole closed.

    ``exact_rate`` is the bar D6 replaces ``|dN| <= 1.0`` with. It is not a
    stricter version of the same thing: at N=2 the absolute cap passes a session
    that rendered two people as one, and no tightening of a bound that admits
    the worst outcome fixes that. Only counting exact hits does.
    """

    sessions: int
    exact_rate: float
    over_split_rate: float
    merge_rate: float
    signed_mean: float
    abs_mean: float

    def as_row(self) -> dict[str, str]:
        return {
            "exact_count_rate": f"{self.exact_rate:.6f}",
            "over_split_rate": f"{self.over_split_rate:.6f}",
            "merge_rate": f"{self.merge_rate:.6f}",
            "speaker_count_signed_error": f"{self.signed_mean:.4f}",
            "speaker_count_abs_error": f"{self.abs_mean:.4f}",
        }


def count_metrics(scores: list[SessionScore]) -> CountMetrics:
    """Aggregate count behaviour across meetings, never netting the two failures.

    A mean of signed errors alone would let an over-split meeting cancel a
    merged one and report zero, so the signed mean is published beside the two
    rates rather than instead of them.
    """
    if not scores:
        return CountMetrics(0, 0.0, 0.0, 0.0, 0.0, 0.0)

    errors = np.array([score.speaker_count_error for score in scores], dtype=np.int64)
    return CountMetrics(
        sessions=len(scores),
        exact_rate=float(np.mean(errors == 0)),
        over_split_rate=float(np.mean(errors > 0)),
        merge_rate=float(np.mean(errors < 0)),
        signed_mean=float(errors.mean()),
        abs_mean=float(np.abs(errors).mean()),
    )
