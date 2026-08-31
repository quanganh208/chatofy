"""The end-of-session settle pass, and the two errors it must never net.

The online attributor is greedy and path-dependent: the first vector
unconditionally creates cluster 0, and every later decision is taken against
whatever the centroids happened to be at that moment. A session that has
finished has no such constraint — every vector is available at once — so
re-clustering the whole session can repair labels the live pass got wrong.

**It is a second clustering algorithm, and it is measured as one.** Nothing in
this bench clustered offline before; the online module is strictly incremental.
Shipping a settle pass on the argument that batch beats greedy, without a
number, would be exactly the kind of claim the rest of this bench exists to
refuse.

**Merge error and split error are reported separately and never netted.** They
are not two sizes of one mistake. A split shows one person under two ordinals:
the user sees it, and it is correctable. A merge folds two people into one
ordinal: the user cannot see it, and in a translation app it silently puts the
counterpart's words in their own mouth. A settle pass that fixes three splits
and causes one merge is not "net +2" — it may well be worse than doing nothing,
and only the two numbers side by side can say.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


def settle(
    vectors: np.ndarray,
    *,
    threshold: float,
    k_max: int | None = None,
) -> list[int]:
    """Re-cluster a finished session's turn vectors, returning one label per turn.

    Average-linkage agglomerative clustering on cosine distance. ``threshold``
    is a cosine *similarity* — the same units as ``tau_assign`` — so the two
    passes can be configured off one calibrated number rather than two that
    drift apart.

    Labels come back renumbered in **first-appearance order**, which is what the
    product's ordinals are: the person who speaks first is speaker 1. Scipy's
    own cluster ids carry no such meaning, and using them raw would make the
    settled transcript renumber itself for no reason the user could see.
    """
    if len(vectors) == 0:
        return []
    if len(vectors) == 1:
        return [0]

    from scipy.cluster.hierarchy import fcluster, linkage

    tree = linkage(np.asarray(vectors, dtype=np.float64), method="average", metric="cosine")
    raw = fcluster(tree, t=1.0 - threshold, criterion="distance")

    if k_max is not None and len(set(raw)) > k_max:
        # `maxclust` cuts the same tree lower down, so the bound is enforced by
        # merging the closest clusters rather than by discarding turns.
        raw = fcluster(tree, t=k_max, criterion="maxclust")

    order: dict[int, int] = {}
    for label in raw:
        if int(label) not in order:
            order[int(label)] = len(order)
    return [order[int(label)] for label in raw]


@dataclass(frozen=True)
class SettleErrors:
    """Split and merge, counted apart.

    ``split_extra`` is how many surplus ordinals the user sees: summed over true
    speakers, the number of distinct clusters their turns landed in, minus one.

    ``merge_extra`` is how many people were absorbed into somebody else's
    ordinal: summed over clusters, the number of distinct true speakers in them,
    minus one.

    Both are zero exactly when the clustering is a perfect one-to-one, and
    neither can be recovered from the other or from a signed count error — a
    session that splits one speaker in two *and* merges two others has count
    error zero and is wrong twice.
    """

    turns: int
    true_speakers: int
    clusters: int
    split_extra: int
    merge_extra: int

    @property
    def clean(self) -> bool:
        return self.split_extra == 0 and self.merge_extra == 0


def settle_errors(truth: list[str], labels: list[int]) -> SettleErrors:
    if len(truth) != len(labels):
        raise ValueError(f"{len(truth)} turns but {len(labels)} labels")

    by_speaker: dict[str, set[int]] = {}
    by_cluster: dict[int, set[str]] = {}
    for name, label in zip(truth, labels):
        by_speaker.setdefault(name, set()).add(label)
        by_cluster.setdefault(label, set()).add(name)

    return SettleErrors(
        turns=len(truth),
        true_speakers=len(by_speaker),
        clusters=len(by_cluster),
        split_extra=sum(len(seen) - 1 for seen in by_speaker.values()),
        merge_extra=sum(len(names) - 1 for names in by_cluster.values()),
    )
