"""Cut the prod recordings into turns and propose labels for review.

    uv run python scripts/prepare_prod.py --consent-recorded

Reads `data/prod/sessions.tsv` (gitignored) with columns
`conversation_id  declared_source  channel` and the recordings beside it as
`data/prod/<conversation_id>.webm`, optionally with `<conversation_id>.scribe.json`
(Scribe's whole-file answer, whose `language_code` becomes the proposal).
Recordings are fetched read-only by the route in the README; this script never
touches prod.

Writes `data/prod/turns/*.wav`, `data/prod/labels-todo.tsv` and
`data/prod/ids.txt` -- the conversation ids `tests/test_no_prod_ids.py` checks
no tracked file contains. Everything here is under the gitignored `data/`.

`--consent-recorded` is required, and is the operator saying the README's
"Recordings and consent" section names whose voices these are and that they
agreed to their audio going to Scribe and into this labelled set.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench.labelling import SessionSpec, cut_to_todo, write_todo  # noqa: E402

PROD = BENCH_ROOT / "data" / "prod"
SCRIBE_LANG = {"vie": "vi", "eng": "en", "cmn": "zh", "zho": "zh", "yue": "zh"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--consent-recorded", action="store_true")
    args = parser.parse_args()
    if not args.consent_recorded:
        print("refusing: record ownership and consent in README.md first, then pass --consent-recorded",
              file=sys.stderr)
        return 2
    sessions = PROD / "sessions.tsv"
    if not sessions.exists():
        print(f"no {sessions}; see the README for its columns", file=sys.stderr)
        return 1
    specs = []
    with sessions.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            cid = row["conversation_id"]
            scribe = PROD / f"{cid}.scribe.json"
            proposed = ""
            if scribe.exists():
                proposed = SCRIBE_LANG.get(json.loads(scribe.read_text())["language_code"], "")
            specs.append(SessionSpec(recording=PROD / f"{cid}.webm", session=cid, channel=row["channel"],
                                     source="prod", declared_source=row["declared_source"],
                                     proposed_lang=proposed))
    (PROD / "ids.txt").write_text("".join(f"{s.session}\n" for s in specs))
    rows = cut_to_todo(specs, PROD / "turns", BENCH_ROOT)
    write_todo(PROD / "labels-todo.tsv", rows)
    print(f"{len(rows)} turns -> data/prod/labels-todo.tsv; copy to labels.tsv and review every row")
    return 0


if __name__ == "__main__":
    sys.exit(main())
