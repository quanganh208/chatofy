"""Run every arm over the labelled turns; one subprocess per arm.

    uv run --frozen python run_bakeoff.py --run-tag r1
    uv run --frozen python run_bakeoff.py --limit 20          # smoke: results/smoke/ only

A subprocess per arm so each one's peak RSS is its own, and so an arm that
dies (OOM under the 4 GiB scope) is recorded rather than taking the run down.
Arms with their own lockfile (`arms/<arm>/`) run with `uv run --frozen` in
their directory, and only when this process is the dedicated `lidbench`
user: they pull model code and weights from the Hub, and the plan does not
allow that on an account that can reach docker or the prod env file.

Output goes to `results/<tag>/`, or `results/private/<tag>/` when any turn
comes from prod or self-recorded sessions. A tag that already exists is
refused -- a recorded result is never rewritten in place -- and `--limit` can
never be combined with `--run-tag`.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import random
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench.manifest import Turn, load, save  # noqa: E402

RESULTS = BENCH_ROOT / "results"
DEFAULT_MANIFESTS = [BENCH_ROOT / "data" / d / "manifest.jsonl" for d in ("public", "conversational", "rerecorded", "prod", "recorded")]
#: The partial cadence (300 ms floor) from the first partial a turn can carry.
DEFAULT_PREFIXES = "600,900,1200,1500,2000,3000"
ISOLATED_USER = "lidbench"
PRIVATE_SOURCES = {"prod", "recorded"}
MEMORY_MAX = "4G"


@dataclass(frozen=True)
class Arm:
    name: str
    cwd: Path
    script: str
    isolated: bool
    takes_prefixes: bool = True


ARMS = {
    a.name: a
    for a in (
        Arm("turn_facts", BENCH_ROOT, "arms/turn_facts.py", isolated=False, takes_prefixes=False),
        Arm("recognizer_competition", BENCH_ROOT, "arms/recognizer_competition.py", isolated=False),
        Arm("ambernet", BENCH_ROOT / "arms" / "ambernet", "arm.py", isolated=True),
        Arm("whisper_probs", BENCH_ROOT / "arms" / "whisper_probs", "arm.py", isolated=True),
        Arm("mms_lid", BENCH_ROOT / "arms" / "mms_lid", "arm.py", isolated=True),
    )
}


def output_dir(run_tag: str | None, limit: int | None, private: bool, resume: bool = False) -> Path:
    """Where this run writes. Raises SystemExit on a forbidden combination."""
    if limit is not None and run_tag is not None:
        raise SystemExit("--limit is a smoke run and writes only results/smoke/; drop --run-tag")
    if limit is not None:
        return RESULTS / "smoke" / time.strftime("%Y%m%d-%H%M%S")
    if not run_tag:
        raise SystemExit("--run-tag is required for a recorded run")
    out = RESULTS / ("private" if private else "") / run_tag
    if out.exists() and not resume:
        raise SystemExit(f"{out} already exists; a recorded run is never overwritten -- pick a new tag")
    return out


def sample(turns: list[Turn], per_label: int) -> list[Turn]:
    by_label: dict[str, list[Turn]] = {}
    for turn in turns:
        by_label.setdefault(turn.lang, []).append(turn)
    rng = random.Random(0)
    return [t for label in sorted(by_label) for t in rng.sample(by_label[label], min(per_label, len(by_label[label])))]


def run_arm(arm: Arm, manifest: Path, out: Path, prefixes: str, threads: int, scope: bool,
            extra: list[str] = ()) -> dict:
    command = ["uv", "run", "--frozen", "python", arm.script, "--manifest", str(manifest), "--out", str(out), *extra]
    if arm.takes_prefixes:
        command += ["--prefixes", prefixes]
    if scope:
        command = ["systemd-run", "--user", "--scope", "-q", "-p", f"MemoryMax={MEMORY_MAX}",
                   "-p", "MemorySwapMax=0", *command]
    started = time.time()
    proc = subprocess.run(command, cwd=arm.cwd, env={**os.environ, "LOCAL_STT_THREADS": str(threads)})
    status = {"arm": arm.name, "exit": proc.returncode, "seconds": round(time.time() - started, 1)}
    # 137 = SIGKILL, which is what the scope's MemoryMax delivers.
    if proc.returncode in (137, -9):
        status["oom"] = True
    return status


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, action="append")
    parser.add_argument("--arms", default=",".join(ARMS))
    parser.add_argument("--run-tag")
    parser.add_argument("--limit", type=int, help="smoke run: this many turns per label")
    parser.add_argument("--prefixes", default=DEFAULT_PREFIXES)
    parser.add_argument("--threads", type=int, default=4, help="LOCAL_STT_THREADS (prod: 4)")
    parser.add_argument("--no-scope", action="store_true",
                        help="skip the per-arm systemd memory scope (tests, or a caller that caps the whole run)")
    parser.add_argument("--resume", action="store_true",
                        help="continue an interrupted tag: same manifest required; arms with scores are skipped")
    parser.add_argument("--whisper-sizes", help="subset of whisper_probs sizes, e.g. tiny,base (default: all pinned)")
    args = parser.parse_args()

    manifests = args.manifest or [m for m in DEFAULT_MANIFESTS if m.exists()]
    turns = [t for m in manifests for t in load(m)]
    if not turns:
        raise SystemExit("no turns: run scripts/prepare_public.py (and apply_labels.py) first")
    if args.limit is not None:
        turns = sample(turns, args.limit)
    private = any(t.source in PRIVATE_SOURCES for t in turns)
    out = output_dir(args.run_tag, args.limit, private, args.resume)
    combined = out / "manifest.jsonl"
    if args.resume and combined.exists():
        recorded = combined.read_bytes()
        save(combined, turns)
        if combined.read_bytes() != recorded:
            combined.write_bytes(recorded)
            raise SystemExit(f"{combined} differs from the manifests now on disk; resume needs the same turns")
    else:
        out.mkdir(parents=True)
        save(combined, turns)

    statuses = []
    user = getpass.getuser()
    for name in args.arms.split(","):
        arm = ARMS[name]
        if arm.isolated and user != ISOLATED_USER:
            print(f"skip  {name}: must run as {ISOLATED_USER} (README, 'Isolation'); running as {user}")
            statuses.append({"arm": name, "skipped": f"not isolated (user {user})"})
            continue
        if arm.isolated and not (arm.cwd / "uv.lock").exists():
            statuses.append({"arm": name, "skipped": "no uv.lock"})
            continue
        print(f"run   {name}")
        extra = ["--sizes", args.whisper_sizes] if name == "whisper_probs" and args.whisper_sizes else []
        statuses.append(run_arm(arm, combined.resolve(), out.resolve(), args.prefixes, args.threads,
                                scope=not args.no_scope, extra=extra))
    (out / "run.json").write_text(json.dumps({"turns": len(turns), "prefixes": args.prefixes,
                                              "threads": args.threads, "arms": statuses}, indent=2) + "\n")
    print(f"wrote {out.relative_to(BENCH_ROOT)}")
    return 0 if all(s.get("exit", 0) == 0 for s in statuses) else 1


if __name__ == "__main__":
    sys.exit(main())
