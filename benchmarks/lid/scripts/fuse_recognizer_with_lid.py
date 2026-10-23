"""Recognizer competition with a LID model's answer as one more feature.

    uv run --frozen python scripts/fuse_recognizer_with_lid.py --run-tag conv-r2-all --lid ambernet

Neither arm alone covers the gate: arm 4 is strong on vi<->en and weak on zh,
AmberNet the reverse. This writes a third arm, `recognizer_<lid>`, whose rows
are arm 4's features with each engine's language also carrying the LID model's
log-probability over the triple (`lid_logp`). score.py then fits it exactly as
it fits arm 4 -- one logistic regression per candidate set, out of fold,
leave-one-group-out -- so the fused classifier is held to the same validation.

Nothing is re-run: both arms' scores rows already exist in the run directory,
for the same manifest. The LID model's latency goes into `engine_ms` as `lid`,
counted as running beside the decodes (score.py's A7 takes the slowest), and
its RSS is what the fused arm adds over today.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench.features import LID_FEATURE  # noqa: E402
from lid_bench.run_data import FULL_KEY, LID_ENGINE  # noqa: E402

RECOGNIZER = "recognizer_competition"
#: log(p) of a probability the model put at zero: finite, and far below any real answer.
LOG_FLOOR = math.log(1e-12)


def read_rows(path: Path) -> dict[tuple[str, int | None], dict]:
    return {(r["id"], r["prefix_ms"]): r for r in map(json.loads, path.read_text().splitlines())}


def fuse(recognizer: dict, lid: dict) -> dict:
    probs = lid["probs"][FULL_KEY]
    features = {lang: {**values, LID_FEATURE: math.log(max(probs[lang], math.exp(LOG_FLOOR)))}
                for lang, values in recognizer["features"].items()}
    return {**recognizer, "features": features,
            "engine_ms": {**recognizer["engine_ms"], LID_ENGINE: lid["latency_ms"]}}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run-tag", required=True)
    parser.add_argument("--lid", required=True, help="a model arm already scored in the run, e.g. ambernet")
    args = parser.parse_args()

    run_dir = next((d for d in (BENCH_ROOT / "results" / args.run_tag, BENCH_ROOT / "results" / "private" / args.run_tag)
                    if d.exists()), None)
    if run_dir is None:
        raise SystemExit(f"no run {args.run_tag}")
    name = f"recognizer_{args.lid}"
    if (run_dir / f"{name}.scores.jsonl").exists():
        raise SystemExit(f"{name} already in {run_dir}: a recorded result is never rewritten")

    recognizer = read_rows(run_dir / f"{RECOGNIZER}.scores.jsonl")
    lid = read_rows(run_dir / f"{args.lid}.scores.jsonl")
    missing = sorted(k for k in recognizer if k not in lid)
    if missing:
        raise SystemExit(f"{len(missing)} {RECOGNIZER} rows have no {args.lid} row, e.g. {missing[0]}")
    rows = [{"id": key[0], **fuse(row, lid[key])} for key, row in recognizer.items()]

    rec_meta = json.loads((run_dir / f"{RECOGNIZER}.meta.json").read_text())
    lid_meta = json.loads((run_dir / f"{args.lid}.meta.json").read_text())
    parity = run_dir / f"{args.lid}.parity.json"
    meta = {
        "arm": name, "kind": "recognizer", "runtime": lid_meta["runtime"],
        "parity_passed": json.loads(parity.read_text())["passed"] if parity.exists() else lid_meta.get("parity_passed"),
        "needs_gpu": lid_meta["needs_gpu"], "needs_torch": lid_meta["needs_torch"], "new_model": True,
        "rss_peak_mib": rec_meta["rss_peak_mib"] + lid_meta["rss_delta_mib"],
        "rss_delta_mib": lid_meta["rss_delta_mib"],
        "notes": [f"{RECOGNIZER} features + {args.lid} log-probs; probabilities out of fold from score.py",
                  f"latency: slowest of the candidate decodes and {args.lid}, run beside them",
                  *lid_meta.get("notes", [])],
    }
    (run_dir / f"{name}.scores.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    (run_dir / f"{name}.meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"{name}: {len(rows)} rows -> {run_dir.relative_to(BENCH_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
