"""Sentence-level chrF++ for `score.mjs`, with the same metric `live-translate` reports.

Reads a JSON list of {"hyp": str, "ref": str} on stdin and writes a JSON list
of scores in the same order. Run through uv so sacrebleu is the only thing it
needs:

    uv run --no-project --with "sacrebleu>=2.4" python -I chrf.py < pairs.json
"""

from __future__ import annotations

import json
import sys

from sacrebleu.metrics import CHRF


def main() -> None:
    pairs = json.load(sys.stdin)
    # word_order=2 is chrF++, as `live-translate/score-adequacy.py` computes it.
    metric = CHRF(word_order=2)
    json.dump([metric.sentence_score(p["hyp"], [p["ref"]]).score for p in pairs], sys.stdout)


if __name__ == "__main__":
    main()
