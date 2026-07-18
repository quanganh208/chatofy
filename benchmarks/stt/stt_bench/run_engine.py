"""Run ONE engine over a manifest and write per-utterance results as JSONL.

Invoked as a standalone process per engine (by run_benchmark.py or manually)
so peak RSS reflects only this engine:

    uv run python -m stt_bench.run_engine --engine sherpa-zipformer-vi \
        --manifest data/manifest-vi.jsonl --out results/sherpa-zipformer-vi.jsonl

Output: one header record {type: "header", engine, load_s, peak_rss_mb, ...}
followed by one {type: "utterance", ...} record per utterance. The first
utterance is transcribed once untimed as warmup (JIT/caches), then all
utterances (including it) are timed.
"""

import argparse
import json
import sys
import time
from pathlib import Path

from .engines import create_engine
from .manifest import load_manifest
from .metrics import PeakRssSampler, rtf


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", required=True)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    engine = create_engine(args.engine)
    utterances = load_manifest(args.manifest)
    mismatched = [u.id for u in utterances if u.lang != engine.lang]
    if mismatched:
        print(f"[error] manifest lang != engine lang for {mismatched[:3]}...", file=sys.stderr)
        return 1

    sampler = PeakRssSampler().start()

    load_start = time.perf_counter()
    engine.load()
    load_s = time.perf_counter() - load_start
    print(f"[{engine.engine_id}] loaded in {load_s:.2f}s", file=sys.stderr)

    # Warmup: first inference pays one-time costs (kernel JIT, allocator
    # growth); run it untimed so per-utterance numbers are steady-state.
    engine.transcribe(utterances[0].audio_path)

    records = []
    for utt in utterances:
        start = time.perf_counter()
        hyp_text = engine.transcribe(utt.audio_path)
        proc_s = time.perf_counter() - start
        records.append(
            {
                "type": "utterance",
                "engine": engine.engine_id,
                "utt_id": utt.id,
                "lang": utt.lang,
                "ref_text": utt.ref_text,
                "hyp_text": hyp_text,
                "audio_s": utt.duration_s,
                "proc_s": round(proc_s, 4),
                "rtf": round(rtf(proc_s, utt.duration_s), 4),
            }
        )
        print(f"[{engine.engine_id}] {utt.id}: {proc_s:.2f}s", file=sys.stderr)

    peak_rss_mb = sampler.stop()
    header = {
        "type": "header",
        "engine": engine.engine_id,
        "lang": engine.lang,
        "is_cloud": engine.is_cloud,
        "load_s": round(load_s, 3),
        "peak_rss_mb": round(peak_rss_mb, 1),
        "num_utterances": len(records),
        "decode_params": engine.decode_params(),
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(json.dumps(header, ensure_ascii=False) + "\n")
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(f"[{engine.engine_id}] wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
