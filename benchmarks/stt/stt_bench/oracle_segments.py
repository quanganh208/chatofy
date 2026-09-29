"""Oracle turn segmentation for batch STT arms.

Splits a reference word list into non-overlapping, padded audio windows so a
batch decoder can be scored on the same turns prod cuts, without re-deciding
where turns start and end. Moved out of `scripts/prod-audio-arms/prod_arms.py`
(which reads `sys.argv` at import time and cannot be imported by tests) with
its `segments(ref, ...)` signature kept, so its four call sites there are
unchanged.

The original padding (-0.15s / +0.25s) let neighbouring segments overlap by
up to 0.4s whenever the underlying gap was small, so words at the seam were
decoded — and counted — twice ("phẫu thuật phẫu thuật"). This version pads
each piece the same way, then clamps every boundary shared with a neighbour
to the midpoint of the gap between them, so no two segments overlap. With a
zero gap (a max_s cap split, where the next word starts right where the
previous segment ends), the midpoint collapses to the word edge itself.
"""

from typing import Any


def segments(
    ref: list[dict[str, Any]],
    max_s: float = 8.0,
    gap: float = 0.3,
    pad_before: float = 0.15,
    pad_after: float = 0.25,
) -> list[tuple[float, float]]:
    words = [w for s in ref for w in s["words"]]

    # Unpadded turn extents, split on a >= gap silence or the max_s cap —
    # same rule prod_arms.py used before this moved.
    raw: list[list[float]] = []
    cur: list[float] | None = None
    for st, en, _ in words:
        if cur and (st - cur[1] >= gap or en - cur[0] > max_s):
            raw.append(cur)
            cur = None
        cur = [st, en] if cur is None else [cur[0], en]
    if cur:
        raw.append(cur)

    padded = [[max(0.0, a - pad_before), b + pad_after] for a, b in raw]

    # Clamp every shared boundary to the midpoint of the gap between the raw
    # (unpadded) extents on either side. That gap is always >= 0 because raw
    # segments are built from words in time order, so the midpoint is always
    # between the two raw extents — never inside either one — which keeps
    # every word's midpoint covered by exactly its own segment.
    for i in range(len(raw) - 1):
        boundary = (raw[i][1] + raw[i + 1][0]) / 2.0
        if padded[i][1] > boundary:
            padded[i][1] = boundary
        if padded[i + 1][0] < boundary:
            padded[i + 1][0] = boundary

    return [(a, b) for a, b in padded]
