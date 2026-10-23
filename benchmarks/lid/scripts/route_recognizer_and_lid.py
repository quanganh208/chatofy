"""Arm 4 for the vi<->en pair, a LID model for every set that holds zh.

    uv run --frozen python scripts/route_recognizer_and_lid.py --from-tag conv-r2-all --to-tag conv-r2-routed --lid ambernet

The sidecar knows the declared pair before it decides, so it can route: en+vi
goes to recognizer competition, vi+zh, en+zh and detect to the LID model. The
new run directory holds the manifest, the facts and one arm,
`routed_<lid>`, whose rows are probabilities per candidate set: arm 4's
out-of-fold ones (from the same classifier score.py fits) and the LID model's
triple masked to the set.

Latency is per set. A LID set is the model's own latency. en+vi is arm 4's
slower engine minus the faster one -- an upper bound on what the decision adds
over the declared engine, whichever of the two the source is.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench import classifier  # noqa: E402
from lid_bench.manifest import load  # noqa: E402
from lid_bench.run_data import FULL_KEY, load_arm, mask, set_key  # noqa: E402

RECOGNIZER = "recognizer_competition"
VIEN = ("en", "vi")


def run_dir(tag: str) -> Path:
    return next((d for d in (BENCH_ROOT / "results" / tag, BENCH_ROOT / "results" / "private" / tag) if d.exists()),
                BENCH_ROOT / "results" / tag)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--from-tag", required=True)
    parser.add_argument("--to-tag", required=True)
    parser.add_argument("--lid", required=True)
    args = parser.parse_args()
    source, target = run_dir(args.from_tag), run_dir(args.to_tag)
    if target.exists():
        raise SystemExit(f"{target} exists: a recorded result is never rewritten")

    turns = load(source / "manifest.jsonl")
    rec = load_arm(source, RECOGNIZER, turns)
    lid = load_arm(source, args.lid, turns)
    rows = []
    for key in sorted(rec.probs, key=lambda k: (k[0], k[1] or 0)):
        if key not in lid.probs:
            raise SystemExit(f"{key} has no {args.lid} row")
        lid_triple = lid.probs[key][FULL_KEY]
        lid_ms = lid.latency[key][FULL_KEY]
        probs, latency = {}, {}
        for subset in classifier.SUBSETS:
            k = set_key(subset)
            if tuple(sorted(subset)) == VIEN:
                probs[k] = rec.probs[key][k]
                engines = rec.engine_ms.get(key[0]) if key[1] is None else None
                latency[k] = (max(engines[l] for l in VIEN) - min(engines[l] for l in VIEN)
                              if engines else rec.latency[key][k])
            else:
                probs[k] = mask(lid_triple, tuple(subset))
                latency[k] = lid_ms
        rows.append({"id": key[0], "prefix_ms": key[1], "speech_ms": rec.speech_ms[key],
                     "probs": probs, "latency_ms": latency})

    rec_meta, lid_meta = rec.info, lid.info
    name = f"routed_{args.lid}"
    meta = {
        "arm": name, "kind": "recognizer", "runtime": lid_meta.runtime, "parity_passed": lid_meta.parity_passed,
        "needs_gpu": lid_meta.needs_gpu, "needs_torch": lid_meta.needs_torch, "new_model": True,
        "rss_peak_mib": (rec_meta.rss_peak_mib or 0.0) + (lid_meta.rss_delta_mib or 0.0),
        "rss_delta_mib": lid_meta.rss_delta_mib,
        "notes": [f"en+vi: {RECOGNIZER} out of fold ({rec.cv_scheme}); sets with zh: {args.lid}",
                  "en+vi latency: slower minus faster engine (upper bound on the added decode)",
                  *lid_meta.notes],
    }
    target.mkdir(parents=True)
    for name_ in ("manifest.jsonl", "facts.jsonl"):
        if (source / name_).exists():
            shutil.copy2(source / name_, target / name_)
    (target / f"{name}.scores.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    (target / f"{name}.meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"{name}: {len(rows)} rows -> {target.relative_to(BENCH_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
