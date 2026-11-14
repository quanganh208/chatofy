"""Build the `conv-r5-decision` run dir: conv-r4-v5 without its noise turns.

    uv run --frozen python scripts/make_decision_run.py

The decision-model arm (`arms/gemini_decision`) sends audio to an external API
whose free tier trains on what it receives. The 160 noise turns are ESC-50
clips under CC-BY-NC-3.0, so they stay home; every speech turn (CC-BY,
CC-BY-SA, MIT) goes. The shipped Whisper arm's rows are copied so `score.py`
scores the new arms against it on exactly the same turns. Removing the noise
turns leaves the speech criteria unchanged (checked: A3.short.by_lang.vi 0.617,
A3.long.vien 0.981); only A5 loses its data.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parents[1]
SOURCE = BENCH_ROOT / "results" / "conv-r4-v5"
TARGET = BENCH_ROOT / "results" / "conv-r5-decision"
BASELINE_ARM = "whisper_probs_base_ctx5"
SPEECH = {"vi", "en", "zh"}


def filter_jsonl(src: Path, dst: Path, keep: set[str]) -> int:
    rows = [line for line in src.read_text().splitlines() if json.loads(line)["id"] in keep]
    dst.write_text("".join(line + "\n" for line in rows))
    return len(rows)


def main() -> int:
    TARGET.mkdir(parents=True, exist_ok=True)
    manifest = [json.loads(line) for line in (SOURCE / "manifest.jsonl").read_text().splitlines()]
    kept = [row for row in manifest if row["lang"] in SPEECH]
    (TARGET / "manifest.jsonl").write_text("".join(json.dumps(row) + "\n" for row in kept))
    keep = {row["id"] for row in kept}
    facts = filter_jsonl(SOURCE / "facts.jsonl", TARGET / "facts.jsonl", keep)
    scores = filter_jsonl(SOURCE / f"{BASELINE_ARM}.scores.jsonl", TARGET / f"{BASELINE_ARM}.scores.jsonl", keep)
    for suffix in ("meta.json", "parity.json"):
        shutil.copyfile(SOURCE / f"{BASELINE_ARM}.{suffix}", TARGET / f"{BASELINE_ARM}.{suffix}")
    print(f"kept {len(kept)} of {len(manifest)} turns; facts {facts}; {BASELINE_ARM} rows {scores}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
