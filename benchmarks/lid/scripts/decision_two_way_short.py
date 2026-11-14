"""Two-way (vi vs en) accuracy on short real turns, per arm, language and source.

    uv run --frozen python scripts/decision_two_way_short.py [--run-tag conv-r5-decision]

`summary.md` has no row for this: its `A3.short.*` rows are 3-way detect and
its A2 rows run the lock and fallback policy over prefixes. The decision-model
bars ask a plainer question of each arm's WHOLE-turn answer: masked to en+vi,
is the argmax the spoken language? Turns are real (not public read speech),
under 1.5 s of speech, and kept by ruler v5 (`score.no_language_turns`).
Prints `<arm> <lang> <source|all> <acc> <n>` per line. On conv-r5-decision the
shipped Whisper arm reads en all 0.987 (n=790) and vi all 0.745 (n=149).
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench.manifest import load  # noqa: E402
from lid_bench.run_data import load_facts, mask  # noqa: E402
from score import no_language_turns  # noqa: E402

SHORT_MS = 1500
PAIR = ("en", "vi")
ARMS = ("whisper_probs_base_ctx5", "gemini_decision", "arbiter_whisper_gemini")


def full_turn_probs(run_dir: Path, arm: str) -> dict[str, dict[str, float]]:
    """Whole-turn `en+vi+zh` probabilities of one arm, by turn id."""
    path = run_dir / f"{arm}.scores.jsonl"
    out = {}
    for line in path.read_text().splitlines():
        row = json.loads(line)
        if row["prefix_ms"] is None:
            out[row["id"]] = row["probs"]["en+vi+zh"]
    return out


def short_turns(run_dir: Path):
    """Real en/vi turns under 1.5 s that ruler v5 scores."""
    turns = load(run_dir / "manifest.jsonl")
    excluded = no_language_turns(turns, load_facts(run_dir))
    return [t for t in turns if t.real and t.lang in PAIR and t.speech_ms < SHORT_MS and t.id not in excluded]


def accuracy(turns, probs: dict[str, dict[str, float]]) -> dict[tuple[str, str], tuple[float, int]]:
    """(lang, source|all) -> (accuracy, n) of the en+vi argmax."""
    hits: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])
    for turn in turns:
        masked = mask(probs[turn.id], PAIR)
        right = int(max(masked, key=masked.get) == turn.lang)
        for key in ((turn.lang, "all"), (turn.lang, turn.source)):
            hits[key][0] += right
            hits[key][1] += 1
    return {key: (h / n, n) for key, (h, n) in hits.items()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run-tag", default="conv-r5-decision")
    args = parser.parse_args()
    run_dir = BENCH_ROOT / "results" / args.run_tag
    turns = short_turns(run_dir)
    for arm in ARMS:
        if not (run_dir / f"{arm}.scores.jsonl").exists():
            print(f"{arm} not run")
            continue
        result = accuracy(turns, full_turn_probs(run_dir, arm))
        for (lang, source), (acc, n) in sorted(result.items(), key=lambda kv: (kv[0][0], kv[0][1] != "all", kv[0][1])):
            print(f"{arm} {lang} {source} {acc:.3f} {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
