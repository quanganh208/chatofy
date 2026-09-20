"""Orchestrate every arm, then refuse to call an incomplete run complete.

    uv run python run_benchmark.py --run-tag r1 --sentences data/sentences-conversational.jsonl
    uv run python run_benchmark.py --check-complete
    uv run python run_benchmark.py --render-only --report-out results/report-speed.md

Three things this does that the harness it was vendored from does not:

**Rendering a report does not re-measure.** In the original, `--report-out`
re-runs every engine, which here would overwrite the very WAVs the scoring stage
is about to transcribe. `--render-only` reads what is on disk.

**Arm order alternates between run tags.** A fixed order lets thermal and
frequency drift land on the same arm in both tags, where it is invisible to any
r1-versus-r2 comparison and reads as a property of the engine.

**`--check-complete` is a gate, not a listing.** A failed arm may not abort the
others — but the run must not be reportable as though nothing was missing.
"""

import argparse
import itertools
import json
import os
import subprocess
import sys
from pathlib import Path

from tts_vi_bench.engines.vieneu_vi import VieNeuVi
from tts_vi_bench.engines.vieneu_vi_int8 import VieNeuViInt8
from tts_vi_bench.engines.zerotts_vi import ZeroTtsVi
from tts_vi_bench.run_engine import voice_slug
from tts_vi_bench.measure import sentence_set_name

BENCH_ROOT = Path(__file__).resolve().parent
RESULTS = BENCH_ROOT / "results"
SENTENCE_SETS = ["conversational", "vivos"]

#: Which engines each run tag measures — per tag, not one list for all of them.
#:
#: A single shared list would make every tag carry every arm, so a tag that
#: measures one more engine would immediately report the earlier tags as
#: incomplete in `check_complete` below — and `score_intelligibility` refuses to
#: score anything at all while that gate is red. r1 and r2 are the recorded 3.3.0
#: evidence: they measured two engines, and must keep measuring exactly those.
#: v381 is the 3.8.1 re-run, which adds the int8 backbone graph as a third arm.
TAG_ENGINES: dict[str, list[type]] = {
    "r1": [VieNeuVi, ZeroTtsVi],
    "r2": [VieNeuVi, ZeroTtsVi],
    "v381": [VieNeuVi, VieNeuViInt8, ZeroTtsVi],
}
RUN_TAGS = list(TAG_ENGINES)

#: Streaming is measured on the conversational set only. It costs a full extra
#: synthesis per sentence, and VIVOS is the comparability arm — the verdict
#: rests on the conversational one, which is also the register the app emits.
STREAM_SETS = {"conversational"}


def arms(tag: str):
    """Every (engine_id, gender, voice) the given tag measures."""
    for cls in TAG_ENGINES[tag]:
        for gender, voice in cls.VOICES.items():
            yield cls.engine_id, gender, voice


def run_tag(tag: str, sentences_path: Path, force: bool) -> list[str]:
    set_name = sentence_set_name(sentences_path)
    out_dir = RESULTS / tag
    ordered = list(arms(tag))
    # Odd-positioned tags run the arms in reverse, so drift does not always favour
    # the same one. With three tags that leaves r1 and v381 sharing an order;
    # accepted rather than rotated further, because v381 re-measures ZeroTTS and
    # that arm reproducing r1/r2 bit-for-bit is the stronger drift check: it
    # isolates the machine rather than assuming the ordering cancels it.
    if RUN_TAGS.index(tag) % 2 == 1:
        ordered.reverse()

    failed = []
    for index, (engine_id, gender, voice) in enumerate(ordered):
        print(f"=== {tag} [{index}] {engine_id} / {voice} / {set_name} ===", flush=True)
        cmd = [
            sys.executable, "-m", "tts_vi_bench.run_engine",
            "--engine", engine_id, "--voice", voice, "--gender", gender,
            "--sentences", str(sentences_path), "--out-dir", str(out_dir),
        ]
        if force:
            cmd.append("--force")
        if set_name not in STREAM_SETS:
            cmd.append("--no-stream")
        if subprocess.run(cmd, cwd=BENCH_ROOT).returncode != 0:
            print(f"[warn] {engine_id}/{voice}/{set_name} failed; continuing", flush=True)
            failed.append(f"{tag}:{engine_id}:{voice_slug(voice)}:{set_name}")
    return failed


def check_complete() -> int:
    """Every arm x set x tag present, and every file as long as it promised."""
    problems = []
    for tag, set_name in itertools.product(RUN_TAGS, SENTENCE_SETS):
        for engine_id, _gender, voice in arms(tag):
            path = RESULTS / tag / f"{engine_id}__{voice_slug(voice)}__{set_name}.jsonl"
            if not path.exists():
                problems.append(f"MISSING {path.relative_to(BENCH_ROOT)}")
                continue
            rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
            header = next((r for r in rows if r["type"] == "header"), None)
            footer = next((r for r in rows if r["type"] == "footer"), None)
            n = sum(1 for r in rows if r["type"] == "sentence")
            if header is None:
                problems.append(f"NO HEADER {path.name}")
                continue
            expected = header["num_sentences_expected"]
            if n != expected:
                problems.append(f"SHORT {path.name}: {n}/{expected} sentences")
            if footer is None:
                problems.append(f"NO FOOTER {path.name} (arm died before finishing)")
            wavs = list((RESULTS / tag / "wav" / engine_id / voice_slug(voice) / set_name).glob("*.wav"))
            if len(wavs) != expected:
                problems.append(
                    f"WAVS {engine_id}/{voice_slug(voice)}/{set_name}@{tag}: "
                    f"{len(wavs)}/{expected}"
                )
    if problems:
        print("INCOMPLETE:", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        return 1
    # Arms differ per tag, so the count is named per tag rather than multiplied out.
    per_tag = ", ".join(f"{tag}: {len(list(arms(tag)))}" for tag in RUN_TAGS)
    print(f"complete: {len(RUN_TAGS)} tags x {len(SENTENCE_SETS)} sets, "
          f"all full length (arms — {per_tag})")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-tag", choices=RUN_TAGS)
    parser.add_argument("--sentences", type=Path)
    parser.add_argument("--all", action="store_true",
                        help="every tag x sentence set, in order")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--check-complete", action="store_true")
    parser.add_argument("--render-only", action="store_true")
    parser.add_argument("--report-out", type=Path)
    args = parser.parse_args()

    if args.check_complete:
        return check_complete()

    failed: list[str] = []
    if not args.render_only:
        if args.all:
            for tag, set_name in itertools.product(RUN_TAGS, SENTENCE_SETS):
                failed += run_tag(tag, BENCH_ROOT / "data" / f"sentences-{set_name}.jsonl",
                                  args.force)
        elif args.run_tag and args.sentences:
            failed = run_tag(args.run_tag, args.sentences, args.force)
        elif not args.report_out:
            parser.error("need --all, or --run-tag with --sentences, or --render-only")

    if args.report_out:
        from tts_vi_bench.report import render_report

        args.report_out.parent.mkdir(parents=True, exist_ok=True)
        args.report_out.write_text(render_report(RESULTS), encoding="utf-8")
        print(f"[done] report -> {args.report_out}")

    if failed:
        print(f"[warn] failed arms: {failed}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
