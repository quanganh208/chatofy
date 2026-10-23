"""Arm 4 -- recognizer competition: decode on every engine, record what each believed.

Runs the sidecar's own engine classes (lid_bench.sidecar), so this arm is
already the runtime that would ship: there is no reference model to be
parity-checked against. It writes FEATURES, not probabilities -- the
probabilities come from the cross-validated classifier in score.py, because a
classifier fitted here would be fitted on the turns it then scores.

Full-turn decodes run one at a time so their latency is a clean A7 number;
prefix decodes run `--lanes` at a time (the sidecar's concurrency) because the
partial path is concurrent in production too.

    uv run python arms/recognizer_competition.py --manifest M --out DIR --prefixes 600,900,...
"""

from __future__ import annotations

import argparse
import json
import resource
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench.audio import TARGET_RATE, read_wav  # noqa: E402
from lid_bench.features import engine_features  # noqa: E402
from lid_bench.manifest import load  # noqa: E402
from lid_bench.sidecar import SidecarEngines, speech_ms  # noqa: E402

ARM = "recognizer_competition"


def score_clip(engines: SidecarEngines, samples, prefix_ms: int | None) -> dict:
    duration_s = len(samples) / TARGET_RATE
    per_engine, engine_ms = {}, {}
    for lang in engines.languages:
        decode = engines.decode(lang, samples)
        per_engine[lang] = engine_features(decode, duration_s)
        engine_ms[lang] = round(decode.latency_ms, 2)
    return {"prefix_ms": prefix_ms, "speech_ms": speech_ms(samples), "features": per_engine,
            "engine_ms": engine_ms}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--prefixes", default="")
    parser.add_argument("--lanes", type=int, default=4)
    args = parser.parse_args()

    turns = load(args.manifest)
    prefixes = [int(p) for p in args.prefixes.split(",") if p]
    engines = SidecarEngines()
    args.out.mkdir(parents=True, exist_ok=True)
    rows = []
    for index, turn in enumerate(turns):
        samples = read_wav(BENCH_ROOT / turn.audio)
        rows.append({"id": turn.id, **score_clip(engines, samples, None)})
        if index % 100 == 0:
            print(f"{ARM}: full {index}/{len(turns)}", flush=True)

    jobs = [(turn, ms) for turn in turns for ms in prefixes]

    def prefix_job(job):
        turn, ms = job
        samples = read_wav(BENCH_ROOT / turn.audio)
        cut = samples[: int(ms * TARGET_RATE / 1000)]
        if len(cut) < len(samples):
            return {"id": turn.id, **score_clip(engines, cut, ms)}
        return None  # the turn is shorter than this prefix; its full row covers it

    with ThreadPoolExecutor(max_workers=args.lanes) as pool:
        for index, row in enumerate(pool.map(prefix_job, jobs)):
            if row is not None:
                rows.append(row)
            if index % 500 == 0:
                print(f"{ARM}: prefix {index}/{len(jobs)}", flush=True)

    with (args.out / f"{ARM}.scores.jsonl").open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row) + "\n")
    meta = {
        "arm": ARM, "kind": "recognizer", "runtime": "onnxruntime-1.27.0", "parity_passed": None,
        "needs_gpu": False, "needs_torch": False, "new_model": False,
        "rss_peak_mib": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1),
        # No weights beyond the sidecar's own; its cost is concurrency (more
        # decodes per turn), which A8 measures on an isolated instance.
        "rss_delta_mib": 0.0,
        "notes": ["features only; probabilities are out-of-fold from score.py",
                  "zh engine leaves ys_log_probs empty; its confidence features are 0, text features carry it"],
    }
    (args.out / f"{ARM}.meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
