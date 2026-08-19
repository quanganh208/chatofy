"""Score what segment-wise translation costs against translating the whole turn.

Reads the rows `segment-vs-whole.mjs` wrote and scores three arms against the
same references:

    whole         one call on the finished utterance — what the cascade does now
    punctuation   segment-wise, cut at clause marks — the OPTIMISTIC bound
    proportional  segment-wise, cut every ~3s mid-clause — the PESSIMISTIC bound

The output is a bracket, not a verdict. The policy a real implementation would
use cuts on silence, which falls between these two and which the harness cannot
reproduce without forced alignment.

chrF++ rather than COMET, deliberately: this compares three outputs of the SAME
model against the same reference, so what matters is a metric that is sensitive
to the local damage segmentation does — dropped particles, mangled clause joins
— and that anyone can reproduce without a 2GB model download. `score-adequacy.py`
next door uses COMET where the comparison is between two different systems.

Usage:
    uv run python score-segments.py results/<stamp>/segments.jsonl
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

from sacrebleu.metrics import CHRF

#: chrF++ — the "++" is word bigrams on top of character n-grams, which is what
#: makes it notice a clause boundary rendered as two disjoint fragments.
CHRF_PP = CHRF(word_order=2)

ARMS = ("whole", "punctuation", "proportional")


def arm_text(row: dict, arm: str) -> str | None:
    if arm == "whole":
        value = row.get("whole")
        return value if isinstance(value, str) else None
    section = row.get(arm)
    return section.get("joined") if isinstance(section, dict) else None


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    path = Path(sys.argv[1])
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

    failed = [r for r in rows if r.get("error")]
    usable = [r for r in rows if not r.get("error")]
    if not usable:
        print("No usable rows — every utterance failed. Nothing to score.")
        return 1

    # Grouped by direction as well as pooled: Vietnamese is where the risk lives
    # (sentence-final particles carry polarity, and the transcript has no
    # punctuation), so a pooled number could hide the whole effect behind the
    # English half.
    groups: dict[str, list[dict]] = defaultdict(list)
    for row in usable:
        groups[f"{row['lang']}->{row['target']}"].append(row)

    print(f"scored {len(usable)} utterances" + (f", {len(failed)} failed" if failed else ""))
    print()

    for label in [*sorted(groups), "all"]:
        subset = usable if label == "all" else groups[label]
        refs = [[r["reference"] for r in subset]]
        print(f"--- {label}  (n={len(subset)}) ---")
        baseline = None
        for arm in ARMS:
            hyps = [arm_text(r, arm) or "" for r in subset]
            score = CHRF_PP.corpus_score(hyps, refs).score
            if arm == "whole":
                baseline = score
                print(f"  {arm:<13} {score:6.2f}")
            else:
                delta = score - (baseline or 0.0)
                # A row this arm could not cut IS the whole arm, so it contributes
                # a certain zero to the delta. Reported per arm, because a delta
                # built mostly from uncut rows understates the damage and does so
                # in the direction that makes early commitment look cheap.
                uncut = sum(1 for r in subset if len(r.get(arm, {}).get("segments", [])) <= 1)
                note = f"   [{uncut}/{len(subset)} uncut]" if uncut else ""
                print(f"  {arm:<13} {score:6.2f}   {delta:+6.2f} vs whole{note}")
        print()

    # Stated, not assumed: the references were produced by a model outside both
    # arms and have not been post-edited, so these are pseudo-references. The
    # DELTA between arms is what this experiment is for; the absolute level is
    # not comparable with published chrF++ numbers.
    print("References are un-post-edited pseudo-references (manifest.referenceProvenance).")
    print("Read the deltas, not the absolute scores.")
    if failed:
        print(f"\n{len(failed)} utterance(s) failed and were excluded:")
        for row in failed:
            print(f"  {row['id']}: {row['error'][:120]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
