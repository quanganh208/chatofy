"""Cut self-recorded sessions into turns and write them out for labelling.

    uv run python scripts/prepare_recorded.py

Reads `data/recorded/sessions.tsv` (gitignored) with columns
`file  session  channel  kind  declared_source` where `file` is relative to
`data/recorded/`, `channel` is `laptop` / `phone` / `speaker`, and `kind` is
`two-way`, `mono`, `codeswitch` or `noise` (phase-00 step 3b). Real speech only:
nothing synthesised belongs here.

Writes `data/recorded/turns/*.wav` and `data/recorded/labels-todo.tsv`. A mono
session's turns are proposed in its declared language and flagged `mono`;
everything else is left for the reviewer to label.
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench.labelling import SessionSpec, cut_to_todo, write_todo  # noqa: E402

RECORDED = BENCH_ROOT / "data" / "recorded"
KINDS = {"two-way", "mono", "codeswitch", "noise"}
CHANNELS = {"laptop", "phone", "speaker"}


def main() -> int:
    sessions = RECORDED / "sessions.tsv"
    if not sessions.exists():
        print(f"no {sessions}; see the docstring for its columns", file=sys.stderr)
        return 1
    specs = []
    with sessions.open(encoding="utf-8", newline="") as fh:
        for line_no, row in enumerate(csv.DictReader(fh, delimiter="\t"), start=2):
            if row["kind"] not in KINDS or row["channel"] not in CHANNELS:
                print(f"{sessions}:{line_no}: kind must be one of {sorted(KINDS)}, channel one of "
                      f"{sorted(CHANNELS)}", file=sys.stderr)
                return 1
            mono = row["kind"] == "mono"
            proposed = {"noise": "noise", "codeswitch": "vi"}.get(row["kind"], row["declared_source"] if mono else "")
            specs.append(SessionSpec(recording=RECORDED / row["file"], session=row["session"],
                                     channel=row["channel"], source="recorded",
                                     declared_source=row["declared_source"], mono=mono, proposed_lang=proposed))
    rows = cut_to_todo(specs, RECORDED / "turns", BENCH_ROOT)
    write_todo(RECORDED / "labels-todo.tsv", rows)
    print(f"{len(rows)} turns -> data/recorded/labels-todo.tsv; copy to labels.tsv and review every row")
    return 0


if __name__ == "__main__":
    sys.exit(main())
