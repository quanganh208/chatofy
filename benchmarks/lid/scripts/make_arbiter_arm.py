"""Derive `arbiter_whisper_gemini`: Whisper, except where it is unsure on a whole turn.

    uv run --frozen python scripts/make_arbiter_arm.py [--run-tag conv-r5-decision]

The only live role an external decision model could play in LID is a
final-turn arbiter: the shipped Whisper head answers every partial and the
final as today, and only a final it is unsure of (en+vi max below 0.6, prod's
`LID_UNCERTAIN_BELOW`) is sent to Gemini Decision 1, whose answer replaces
Whisper's for that turn. No API call is made here; the two arms' recorded
rows are combined.

A replaced row's latency is Whisper's plus Gemini's own round trip, taken from
the last successful attempt in `gemini_decision.http.jsonl` (the scores file's
latency also counts back-off waits). Prefix rows stay Whisper's.

Also prints, report-only, how many turns other thresholds would send and the
two-way short accuracy they would reach; at 0.6 Whisper is unsure of only
about 54 en/vi turns, so 0.6 alone can barely move the error rate.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BENCH_ROOT))
sys.path.insert(0, str(BENCH_ROOT / "scripts"))

from decision_two_way_short import accuracy, short_turns  # noqa: E402
from lid_bench.run_data import mask  # noqa: E402

WHISPER = "whisper_probs_base_ctx5"
GEMINI = "gemini_decision"
ARM = "arbiter_whisper_gemini"
THRESHOLD = 0.6
SWEEP = (0.6, 0.7, 0.8, 0.9)
FULL = "en+vi+zh"


def unsure(probs: dict[str, float], threshold: float) -> bool:
    masked = mask(probs, ("en", "vi"))
    return max(masked.values()) < threshold


def gemini_round_trips(http_log: Path) -> dict[str, float]:
    """Each turn's last successful round trip in ms."""
    out = {}
    for line in http_log.read_text().splitlines():
        row = json.loads(line)
        if row["status"] == 200:
            out[row["id"]] = row["ms"]
    return out


def arbiter_rows(whisper_rows: list[dict], gemini_full: dict[str, dict], round_trips: dict[str, float],
                 threshold: float = THRESHOLD) -> tuple[list[dict], int]:
    """Whisper's rows with each unsure whole turn answered by Gemini; returns (rows, replaced)."""
    out, replaced = [], 0
    for row in whisper_rows:
        if row["prefix_ms"] is None and unsure(row["probs"][FULL], threshold):
            out.append({**row, "probs": {FULL: gemini_full[row["id"]]},
                        "latency_ms": round(row["latency_ms"] + round_trips[row["id"]], 2)})
            replaced += 1
        else:
            out.append(row)
    return out, replaced


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run-tag", default="conv-r5-decision")
    args = parser.parse_args()
    run_dir = BENCH_ROOT / "results" / args.run_tag
    whisper_rows = [json.loads(line) for line in (run_dir / f"{WHISPER}.scores.jsonl").read_text().splitlines()]
    gemini_full = {}
    for line in (run_dir / f"{GEMINI}.scores.jsonl").read_text().splitlines():
        row = json.loads(line)
        if row["prefix_ms"] is None:
            gemini_full[row["id"]] = row["probs"][FULL]
    round_trips = gemini_round_trips(run_dir / f"{GEMINI}.http.jsonl")

    rows, replaced = arbiter_rows(whisper_rows, gemini_full, round_trips)
    (run_dir / f"{ARM}.scores.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    (run_dir / f"{ARM}.meta.json").write_text(json.dumps({
        "arm": ARM, "kind": "lid-model", "runtime": "external-api", "parity_passed": None,
        "notes": [f"{WHISPER} whole turn unless its en+vi max < {THRESHOLD}, then gemini-decision-1",
                  "prefix rows are Whisper's; latency of a replaced turn adds Gemini's round trip from the dev desk"],
    }, indent=2) + "\n")
    print(f"replaced {replaced}")

    turns = short_turns(run_dir)
    for threshold in SWEEP:
        swept, n = arbiter_rows(whisper_rows, gemini_full, round_trips, threshold)
        full = {r["id"]: r["probs"][FULL] for r in swept if r["prefix_ms"] is None}
        result = accuracy(turns, full)
        print(f"threshold {threshold} replaced {n} short_vi {result[('vi', 'all')][0]:.3f} "
              f"short_en {result[('en', 'all')][0]:.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
