"""Trial-pair construction from a corpus with no session metadata.

Pair construction is where a bench lies to you, so the rules live here and are
enforced rather than advised. Two of them come from the plan; the third was
measured into existence by `scripts/probe_channel_leakage.py`.

**Rule 1 — same-speaker pairs must not share a source recording.** Clips from
one continuous recording share microphone, room, codec and AGC state, so their
cosine is inflated by shared channel rather than shared identity. VoxVietnam
carries no session id, so the rule cannot be applied directly. What the probe
found is that scan-order distance is a usable stand-in:

| index gap | mean same-speaker cosine |
| --- | --- |
| [1, 5) | 0.6315 |
| [5, 25) | 0.5852 |
| [25, 100) | 0.5301 |
| [100, 1000) | 0.5167 |

Adjacent clips score ~0.096 higher than distant ones. Paired within speaker the
gap is +0.091, so it is not an artifact of which speakers can supply which gaps
(Wilcoxon p=0.013; the per-speaker sign test is 14/23, p=0.20, so this is a real
average effect with high variance, not a universal law). The curve is flat from
about 25 onward, which sets :data:`MIN_INDEX_GAP`.

This mitigates the inflation; it does not eliminate it. Two clips 25 rows apart
may still come from one long video. The residual is unmeasurable with this
corpus and belongs in the gate report as a stated limitation.

**Rule 2 — buckets are never pooled.** Both sides of a pair are truncated to the
same bucket length, so a cell measures one duration rather than an average over
several.

**Rule 3 — no speaker may dominate.** Utterances per speaker run from 1 to 2,559
against a median of 8. Unbalanced sampling would let three voices supply most of
both distributions, and the resulting EER would describe those three people.
:data:`MAX_PAIRS_PER_SPEAKER` caps the contribution and the effective speaker
count is reported beside every EER.
"""

from __future__ import annotations

import random
from collections import defaultdict
from dataclasses import dataclass
from typing import Sequence

from .corpus import Utterance

#: Minimum scan-order distance between the two sides of a same-speaker pair.
#:
#: Measured against its own cost, not chosen for looking prudent. Raising the
#: gap removes channel inflation but excludes speakers whose clips all sit close
#: together, and most speakers here hold only 8-16 clips:
#:
#: | min gap | speakers | target pairs | mean same-speaker cosine |
#: | --- | --- | --- | --- |
#: | 0 | 143 | 4553 | 0.5598 |
#: | 5 | 129 | 3814 | 0.5419 |
#: | 10 | 96 | 3425 | 0.5344 |
#: | **25** | **76** | **2844** | **0.5275** |
#: | 50 | 58 | 2223 | 0.5259 |
#: | 100 | 39 | 1498 | 0.5262 |
#:
#: The inflation is gone by 25 — 0.032 of the total 0.034 drop — and the curve
#: is flat after it. Going on to 100 halves the speaker count for a further
#: 0.0013, which buys nothing and makes the gate describe 39 voices instead of
#: 76. A threshold picked for prudence rather than measured against its cost
#: would have taken that trade silently.
MIN_INDEX_GAP = 25

#: Cap on pairs contributed by any one speaker, per side of the distribution.
MAX_PAIRS_PER_SPEAKER = 40


@dataclass(frozen=True)
class Pair:
    """One trial: two utterances and whether they share a speaker."""

    same: bool
    a: Utterance
    b: Utterance
    bucket_s: float

    @property
    def index_gap(self) -> int:
        return abs(self.a.order - self.b.order)


def eligible_by_speaker(
    index: Sequence[Utterance], bucket_s: float
) -> dict[str, list[Utterance]]:
    """Speakers with at least two utterances long enough to fill the bucket.

    Truncation only ever shortens, so an utterance qualifies for a bucket when
    it is at least that long. A speaker with one qualifying clip can still serve
    as a non-target side, but cannot form a same-speaker pair, so it is dropped
    from this map and the caller reports the reduced speaker count.
    """
    by_speaker: dict[str, list[Utterance]] = defaultdict(list)
    for utterance in index:
        if utterance.duration_s >= bucket_s:
            by_speaker[utterance.speaker].append(utterance)
    return {
        speaker: sorted(items, key=lambda u: u.order)
        for speaker, items in by_speaker.items()
        if len(items) >= 2
    }


def sample_target_pairs(
    by_speaker: dict[str, list[Utterance]],
    bucket_s: float,
    rng: random.Random,
    *,
    min_index_gap: int = MIN_INDEX_GAP,
    max_per_speaker: int = MAX_PAIRS_PER_SPEAKER,
) -> list[Pair]:
    """Same-speaker pairs, gap-constrained and per-speaker capped.

    Every speaker is offered the same cap, so the distribution is shaped by the
    corpus's speaker diversity rather than by its most prolific voices.
    """
    pairs: list[Pair] = []
    for speaker in sorted(by_speaker):
        items = by_speaker[speaker]
        # All qualifying (i, j) with a large enough gap. Enumerated rather than
        # rejection-sampled: most speakers have few clips, and for them
        # rejection sampling would spin without ever finding a legal pair.
        candidates = [
            (a, b)
            for position, a in enumerate(items)
            for b in items[position + 1 :]
            if abs(b.order - a.order) >= min_index_gap
        ]
        if not candidates:
            continue
        rng.shuffle(candidates)
        for a, b in candidates[:max_per_speaker]:
            pairs.append(Pair(same=True, a=a, b=b, bucket_s=bucket_s))
    return pairs


def sample_nontarget_pairs(
    by_speaker: dict[str, list[Utterance]],
    bucket_s: float,
    rng: random.Random,
    *,
    count: int,
    max_per_speaker: int = MAX_PAIRS_PER_SPEAKER * 2,
) -> list[Pair]:
    """Different-speaker pairs, capped per speaker.

    ``count`` targets a balanced trial list. Balance is not required by the EER
    computation — it sweeps each side's own rate — but an unbalanced list makes
    the two distributions' sampling noise differ, which shows up as a jittery
    threshold rather than a jittery EER, and the threshold is what Phase 4 uses.
    """
    speakers = sorted(by_speaker)
    if len(speakers) < 2:
        return []
    used: dict[str, int] = defaultdict(int)
    pairs: list[Pair] = []
    attempts = 0
    limit = count * 200
    while len(pairs) < count and attempts < limit:
        attempts += 1
        first, second = rng.sample(speakers, 2)
        if used[first] >= max_per_speaker or used[second] >= max_per_speaker:
            continue
        a = rng.choice(by_speaker[first])
        b = rng.choice(by_speaker[second])
        used[first] += 1
        used[second] += 1
        pairs.append(Pair(same=False, a=a, b=b, bucket_s=bucket_s))
    return pairs


def build_trials(
    index: Sequence[Utterance],
    bucket_s: float,
    rng: random.Random,
    *,
    min_index_gap: int = MIN_INDEX_GAP,
    max_per_speaker: int = MAX_PAIRS_PER_SPEAKER,
) -> tuple[list[Pair], dict[str, int]]:
    """Build one bucket's trial list, with the stats needed to judge it.

    The returned stats are not decoration. An EER without its pair count and
    effective speaker count cannot be told apart from an EER over three voices,
    and the plan requires both to be reported beside every cell.
    """
    by_speaker = eligible_by_speaker(index, bucket_s)
    targets = sample_target_pairs(
        by_speaker, bucket_s, rng, min_index_gap=min_index_gap, max_per_speaker=max_per_speaker
    )
    nontargets = sample_nontarget_pairs(
        by_speaker, bucket_s, rng, count=len(targets), max_per_speaker=max_per_speaker * 2
    )
    contributing = {pair.a.speaker for pair in targets} | {pair.b.speaker for pair in targets}
    stats = {
        "speakers_eligible": len(by_speaker),
        "speakers_contributing_targets": len(contributing),
        "target_pairs": len(targets),
        "nontarget_pairs": len(nontargets),
    }
    return targets + nontargets, stats


__all__ = [
    "MAX_PAIRS_PER_SPEAKER",
    "MIN_INDEX_GAP",
    "Pair",
    "build_trials",
    "eligible_by_speaker",
    "sample_nontarget_pairs",
    "sample_target_pairs",
]
