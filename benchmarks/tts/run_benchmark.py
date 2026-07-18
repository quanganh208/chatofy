"""TTS benchmark orchestrator — runs each engine sequentially in its own
subprocess (RAM isolation, no CPU contention).

    uv run python run_benchmark.py --run-tag r1
    uv run python run_benchmark.py --run-tag r2   # variance-check second run
"""

import argparse
import subprocess
import sys
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent
ENGINES = ["sherpa-kokoro-en", "sherpa-piper-en"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-tag", default="r1")
    parser.add_argument("--engines", help="comma-separated subset of engine ids")
    parser.add_argument("--report-out", type=Path, help="render markdown report to this path")
    args = parser.parse_args()

    engines = ENGINES
    if args.engines:
        wanted = {e.strip() for e in args.engines.split(",")}
        unknown = wanted - set(ENGINES)
        if unknown:
            print(f"[error] unknown engine ids {sorted(unknown)}; known: {ENGINES}", file=sys.stderr)
            return 1
        engines = [e for e in engines if e in wanted]

    out_dir = BENCH_ROOT / "results" / args.run_tag
    failed = []
    for engine_id in engines:
        print(f"=== {engine_id} ===", flush=True)
        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                "tts_bench.run_engine",
                "--engine",
                engine_id,
                "--sentences",
                "data/sentences-en.txt",
                "--out-dir",
                str(out_dir),
            ],
            cwd=BENCH_ROOT,
        )
        if proc.returncode != 0:
            print(f"[warn] {engine_id} failed (exit {proc.returncode}); continuing", flush=True)
            failed.append(engine_id)

    print(f"[done] results in {out_dir}" + (f" (failed: {failed})" if failed else ""))

    if args.report_out:
        from tts_bench.report import render_report

        args.report_out.parent.mkdir(parents=True, exist_ok=True)
        args.report_out.write_text(render_report(BENCH_ROOT / "results"), encoding="utf-8")
        print(f"[done] report -> {args.report_out}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
