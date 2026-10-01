"""Run arms over the rulers, each arm in its own process.

    uv run python -m punct_bench.run                  # every arm, every row
    uv run python -m punct_bench.run --smoke 20       # 20 rows per ruler
    uv run python -m punct_bench.run --arms dw-mmbert-int8emb vibert-capu-int8

A full run writes results/<arm>/preds.jsonl and results/<arm>/run.json. A smoke
run writes under results/smoke/ instead, and never touches a full run's files:
a smoke over a few rows written where the full results live would be read later
as the recorded result.
"""
import argparse
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

import psutil

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RESULTS = ROOT / "results"
RULERS = (
    "prod",
    "aiwho",
    "fleurs",
    "vicappunc",
    "title-open",
    "greet",
    # Audio rulers: built by scripts/build_audio_rulers.py, with per-word pauses.
    "fleurs-audio",
    "fleurs-audio-dev",
    "prod-audio",
)

SIDECAR = ["uv", "run", "--quiet", "--project", "../../services/local-stt", "python", "-m", "arms.sidecar_arm"]

# id -> how to start it. `group` is the uv dependency group the arm needs;
# `command` replaces the default `uv run python -m <module>` for an arm that
# needs an environment of its own.
ARMS: dict[str, dict] = {
    "floor": {"module": "arms.floor_arm", "variant": "-"},
    "dw-mmbert-int8emb": {"module": "arms.dewpoint_arm", "variant": "mmbert-int8emb"},
    "dw-mmbert-fp32": {"module": "arms.dewpoint_arm", "variant": "mmbert-fp32"},
    "dw-xlmr-large": {"module": "arms.dewpoint_arm", "variant": "xlmr-large"},
    "dw-ensemble": {"module": "arms.dewpoint_arm", "variant": "ensemble"},
    "dw-prod+comma": {"module": "arms.post_rule_arm", "variant": "comma"},
    "dw-prod+title": {"module": "arms.post_rule_arm", "variant": "title"},
    "dw-prod+comma-common": {"module": "arms.post_rule_arm", "variant": "comma-common"},
    "dw-prod+comma-common+title": {"module": "arms.post_rule_arm", "variant": "comma-common+title"},
    "shipped+greet-comma": {"module": "arms.post_rule_arm", "variant": "comma-common+title+greet-comma"},
    "shipped+title-comma": {"module": "arms.post_rule_arm", "variant": "comma-common+title+title-comma"},
    "shipped+both-commas": {"module": "arms.post_rule_arm", "variant": "comma-common+title+greet-comma+title-comma"},
    # The sidecar's own restorer, every shipped rule included; `gate-<ms>-<mark>`
    # adds the pause gate. Runs in the sidecar's environment.
    "sidecar": {"module": "arms.sidecar_arm", "variant": "shipped", "command": SIDECAR},
    "sidecar+gate-120-none": {"module": "arms.sidecar_arm", "variant": "gate-120-none", "command": SIDECAR},
    "sidecar+gate-120-comma": {"module": "arms.sidecar_arm", "variant": "gate-120-comma", "command": SIDECAR},
    "sidecar+gate-200-none": {"module": "arms.sidecar_arm", "variant": "gate-200-none", "command": SIDECAR},
    "sidecar+gate-200-comma": {"module": "arms.sidecar_arm", "variant": "gate-200-comma", "command": SIDECAR},
    "sidecar+gate-300-none": {"module": "arms.sidecar_arm", "variant": "gate-300-none", "command": SIDECAR},
    "sidecar+gate-300-comma": {"module": "arms.sidecar_arm", "variant": "gate-300-comma", "command": SIDECAR},
    "dw-prod+comma+title": {"module": "arms.post_rule_arm", "variant": "comma+title"},
    "vibert-capu-int8": {"module": "arms.vibert_capu_arm", "variant": "int8"},
    "vibert-capu-fp32": {"module": "arms.vibert_capu_arm", "variant": "fp32"},
    "xlmr-capu": {"module": "arms.xlmr_capu_arm", "group": "torch"},
    "badcode-xlmr": {"module": "arms.badcode_arm", "group": "punctuators"},
    "capu-vi-vlsp": {
        "module": "arms.capu_vi_arm",
        "command": ["uv", "run", "--quiet", "--project", "arms/capu_vi_env", "python", "-m", "arms.capu_vi_arm"],
    },
}


def _command(arm: dict) -> list[str]:
    if "command" in arm:
        return list(arm["command"])
    groups = ["--group", arm["group"]] if arm.get("group") else []
    return ["uv", "run", "--quiet", *groups, "python", "-m", arm["module"]]


def _peak_rss_mb(process: subprocess.Popen, stop: threading.Event, peak: list[float]) -> None:
    """Peak resident memory of the arm and its children, sampled every 50 ms.

    Sampled rather than read from `ru_maxrss` because `uv run` is the direct
    child: its own RSS would be the one reported, not the model's.
    """
    root = psutil.Process(process.pid)
    while not stop.is_set():
        try:
            tree = [root, *root.children(recursive=True)]
            peak[0] = max(peak[0], sum(p.memory_info().rss for p in tree if p.is_running()) / 2**20)
        except psutil.Error:
            pass
        stop.wait(0.05)


def run_arm(arm_id: str, threads: int, smoke: int) -> dict:
    arm = ARMS[arm_id]
    out_dir = (RESULTS / "smoke" if smoke else RESULTS) / arm_id
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = [str(path) for name in RULERS if (path := DATA / f"rows-{name}.jsonl").exists()]
    command = [
        *_command(arm),
        "--variant", arm.get("variant", ""),
        "--threads", str(threads),
        "--out", str(out_dir / "preds.jsonl"),
        "--limit", str(smoke),
        *rows,
    ]
    started = time.perf_counter()
    process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    stop, peak = threading.Event(), [0.0]
    sampler = threading.Thread(target=_peak_rss_mb, args=(process, stop, peak), daemon=True)
    sampler.start()
    stdout, stderr = process.communicate()
    stop.set()
    sampler.join()
    record = {
        "arm": arm_id,
        "threads": threads,
        "smoke_rows_per_ruler": smoke,
        "exit": process.returncode,
        "wall_s": round(time.perf_counter() - started, 1),
        "peak_rss_mb": round(peak[0]),
    }
    lines = [line for line in stdout.splitlines() if line.startswith("{")]
    if process.returncode == 0 and lines:
        record.update(json.loads(lines[-1]))
    else:
        record["stderr_tail"] = stderr[-2000:]
    (out_dir / "run.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    return record


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--arms", nargs="*", default=list(ARMS))
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--smoke", type=int, default=0, help="rows per ruler; 0 = full run")
    args = parser.parse_args()
    for arm_id in args.arms:
        record = run_arm(arm_id, args.threads, args.smoke)
        summary = {k: record.get(k) for k in ("arm", "exit", "wall_s", "peak_rss_mb", "load_s", "rows")}
        print(json.dumps(summary), flush=True)
        if record["exit"] != 0:
            print(record.get("stderr_tail", ""), file=sys.stderr)


if __name__ == "__main__":
    main()
