"""Full benchmark orchestrator — runs every engine sequentially in its own
subprocess (RAM isolation; engines never contend for CPU), then aggregates
results into a markdown report.

    uv run python run_benchmark.py                    # local engines, run tag r1
    uv run python run_benchmark.py --run-tag r2       # variance-check second run
    uv run python run_benchmark.py --include-cloud    # + ElevenLabs (needs key)
    uv run python run_benchmark.py --report-out path  # also render the report
    uv run python run_benchmark.py --decoder-arms \
        --run-tag r3-decoder-arms                     # vi decode comparison only

Per-engine results land in results/{run_tag}/{engine}.jsonl.
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent

LOCAL_ENGINES = [
    ("sherpa-zipformer-vi", "data/manifest-vi.jsonl"),
    ("sherpa-moonshine-en", "data/manifest-en.jsonl"),
    ("fw-phowhisper-vi", "data/manifest-vi.jsonl"),
    ("fw-whisper-small-en", "data/manifest-en.jsonl"),
]
CLOUD_ENGINES = [
    ("elevenlabs-vi", "data/manifest-vi.jsonl"),
    ("elevenlabs-en", "data/manifest-en.jsonl"),
]
# vi decoder comparison: identical model files and thread count, only the
# decoder varies. Run under their own run tag so the stack-comparison results
# the report reads stay exactly as recorded.
DECODER_ARM_ENGINES = [
    ("sherpa-zipformer-vi-greedy", "data/manifest-vi.jsonl"),
    ("sherpa-zipformer-vi-beam", "data/manifest-vi.jsonl"),
    ("sherpa-zipformer-vi-beam-hotwords", "data/manifest-vi.jsonl"),
]


def run_one(engine_id: str, manifest: str, out_path: Path) -> bool:
    print(f"=== {engine_id} ===", flush=True)
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "stt_bench.run_engine",
            "--engine",
            engine_id,
            "--manifest",
            manifest,
            "--out",
            str(out_path),
        ],
        cwd=BENCH_ROOT,
    )
    if proc.returncode != 0:
        print(f"[warn] {engine_id} failed (exit {proc.returncode}); continuing", flush=True)
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-tag", default="r1", help="results subdir, e.g. r1/r2")
    parser.add_argument("--include-cloud", action="store_true")
    parser.add_argument(
        "--decoder-arms",
        action="store_true",
        help="run the vi decode-comparison arms INSTEAD of the stack comparison",
    )
    parser.add_argument("--engines", help="comma-separated subset of engine ids")
    parser.add_argument("--report-out", type=Path, help="render markdown report to this path")
    args = parser.parse_args()

    if args.decoder_arms:
        if args.include_cloud:
            print("[error] --decoder-arms is local-only; drop --include-cloud", file=sys.stderr)
            return 1
        engines = DECODER_ARM_ENGINES
    else:
        engines = LOCAL_ENGINES + (CLOUD_ENGINES if args.include_cloud else [])
    if args.engines:
        wanted = {e.strip() for e in args.engines.split(",")}
        known = {engine_id for engine_id, _ in engines}
        unknown = wanted - known
        if unknown:
            print(
                f"[error] unknown engine ids {sorted(unknown)}; known: {sorted(known)}"
                " (cloud ids need --include-cloud)",
                file=sys.stderr,
            )
            return 1
        engines = [e for e in engines if e[0] in wanted]
    if args.include_cloud and not os.environ.get("ELEVENLABS_API_KEY"):
        print("[error] --include-cloud set but ELEVENLABS_API_KEY missing", file=sys.stderr)
        return 1

    out_dir = BENCH_ROOT / "results" / args.run_tag
    failed = []
    for engine_id, manifest in engines:
        ok = run_one(engine_id, manifest, out_dir / f"{engine_id}.jsonl")
        if not ok:
            failed.append(engine_id)

    print(f"[done] results in {out_dir}" + (f" (failed: {failed})" if failed else ""))

    if args.report_out:
        from stt_bench.report import render_report

        args.report_out.parent.mkdir(parents=True, exist_ok=True)
        args.report_out.write_text(render_report(BENCH_ROOT / "results"), encoding="utf-8")
        print(f"[done] report -> {args.report_out}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
