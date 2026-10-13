"""Mandarin (zh) TTS benchmark — Kokoro v1_0 vs v1_1-zh int8, plus the en
regression check of a shared en+zh v1_0 instance.

    uv run python run_zh_benchmark.py --run-tag zh-r1 --lock <path> --stage all

Stages (each refuses to overwrite a finished output; pass a NEW --run-tag):
- synth: one subprocess per (config, speaker): load, untimed warmup, timed
  synthesis of every sentence, peak RSS. zh arms read the zh set; the en
  regression runs read data/sentences-en.txt, and the en-only config runs twice
  (the second into `en-control/`) because Kokoro is not deterministic run to run.
- judge: every judge in its own subprocess over every WAV directory.
- score: `tts_bench.zh_scoring` -> results/<tag>/summary.json + summary.md.

`--lock` wraps every synthesis and judge subprocess in `flock <lock>` so timed
work never overlaps the other benchmark jobs sharing this host's CPU.
"""

import argparse
import subprocess
import sys
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent
ZH_SENTENCES = "data/zh-sentences-conversational.txt"
EN_SENTENCES = "data/sentences-en.txt"

#: (config, speaker ids). Speaker names: tts_bench/engines/sherpa_kokoro_multi.py.
ZH_ARMS = {
    "kokoro-v1_0-en-zh": (45, 46, 47, 48, 49, 50, 51, 52),
    # v1_1-zh ships 55 zf_ and 45 zm_ voices; the first four of each by id.
    "kokoro-v1_1-int8-zh": (3, 4, 5, 6, 58, 59, 60, 61),
}
EN_SIDS = (9, 11)
EN_CONFIGS = ("kokoro-v1_0-en-only", "kokoro-v1_0-en-zh")
EN_CONTROL_DIR = "en-control"
EN_DIR = "en"


def synth_jobs(tag_dir: Path) -> list[tuple[str, int, str, Path]]:
    jobs = [(e, sid, ZH_SENTENCES, tag_dir) for e, sids in ZH_ARMS.items() for sid in sids]
    jobs += [(e, sid, EN_SENTENCES, tag_dir / EN_DIR) for e in EN_CONFIGS for sid in EN_SIDS]
    jobs += [("kokoro-v1_0-en-only", sid, EN_SENTENCES, tag_dir / EN_CONTROL_DIR) for sid in EN_SIDS]
    return jobs


def wav_dir(out_dir: Path, engine: str, sid: int) -> Path:
    return out_dir / "wav" / engine / f"sid{sid}"


def locked(cmd: list[str], lock: Path | None) -> list[str]:
    return ["flock", str(lock), *cmd] if lock else cmd


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd), flush=True)
    proc = subprocess.run(cmd, cwd=BENCH_ROOT)
    if proc.returncode != 0:
        raise SystemExit(f"[error] exit {proc.returncode}: {' '.join(cmd)}")


def stage_synth(tag_dir: Path, lock: Path | None) -> None:
    for engine, sid, sentences, out_dir in synth_jobs(tag_dir):
        result = out_dir / f"{engine}-sid{sid}.jsonl"
        if result.exists():
            print(f"[skip] {result} exists", flush=True)
            continue
        run(locked([sys.executable, "-m", "tts_bench.run_engine", "--engine", engine,
                    "--sid", str(sid), "--sentences", sentences, "--out-dir", str(out_dir)], lock))


def stage_judge(tag_dir: Path, lock: Path | None) -> None:
    jobs = synth_jobs(tag_dir)
    zh_dirs = [wav_dir(o, e, s) for e, s, sent, o in jobs if sent == ZH_SENTENCES]
    en_dirs = [wav_dir(o, e, s) for e, s, sent, o in jobs if sent == EN_SENTENCES]
    for judge, dirs in (("sensevoice-zh", zh_dirs), ("paraformer-zh", zh_dirs), ("parakeet-en", en_dirs)):
        out = tag_dir / "judge" / f"{judge}.jsonl"
        if out.exists():
            print(f"[skip] {out} exists", flush=True)
            continue
        cmd = [sys.executable, "-m", "tts_bench.run_judge", "--judge", judge, "--out", str(out)]
        for d in dirs:
            cmd += ["--wav-dir", str(d)]
        run(locked(cmd, lock))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-tag", required=True)
    parser.add_argument("--stage", choices=("synth", "judge", "score", "all"), default="all")
    parser.add_argument("--lock", type=Path, help="flock file shared with other CPU benchmarks")
    args = parser.parse_args()

    if not args.run_tag.startswith("zh-"):
        parser.error("zh run tags start with 'zh-' so they never collide with the en tags r1/r2")
    tag_dir = BENCH_ROOT / "results" / args.run_tag
    if args.stage in ("synth", "all"):
        stage_synth(tag_dir, args.lock)
    if args.stage in ("judge", "all"):
        stage_judge(tag_dir, args.lock)
    if args.stage in ("score", "all"):
        from tts_bench.zh_scoring import score_run

        score_run(tag_dir, BENCH_ROOT / ZH_SENTENCES, BENCH_ROOT / EN_SENTENCES)
    return 0


if __name__ == "__main__":
    sys.exit(main())
