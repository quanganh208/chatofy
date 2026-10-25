"""No tracked file under benchmarks/lid may carry a prod conversation id.

`data/prod/ids.txt` (gitignored) lists the conversation ids prepare_prod.py
read. Every tracked file is searched for each id, its first 8 hex characters
included, since a short id is enough to look a conversation up.
"""
import subprocess
from pathlib import Path

import pytest

BENCH = Path(__file__).resolve().parent.parent
IDS = BENCH / "data" / "prod" / "ids.txt"


def tracked_files() -> list[Path]:
    out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "."],
                         cwd=BENCH, capture_output=True, text=True, check=True).stdout
    return [BENCH / line for line in out.splitlines() if line]


def test_no_tracked_file_contains_a_prod_conversation_id():
    if not IDS.exists():
        pytest.skip("no prod ids recorded (prepare_prod.py has not run)")
    ids = [line.strip() for line in IDS.read_text().splitlines() if line.strip()]
    needles = {i for i in ids} | {i[:8] for i in ids}
    offenders = []
    for path in tracked_files():
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        offenders += [f"{path.relative_to(BENCH)}: {n}" for n in needles if n in text]
    assert not offenders, offenders


def test_data_and_private_results_are_ignored():
    for probe in ("data/prod/x.wav", "data/prod/labels.tsv", "results/private/p1/x.scores.jsonl",
                  "results/smoke/x/run.json"):
        proc = subprocess.run(["git", "check-ignore", "-q", probe], cwd=BENCH)
        assert proc.returncode == 0, f"{probe} is not ignored"
