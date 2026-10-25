"""The loop every model arm shares: turns and prefixes in, scores rows out.

A model arm only has to say how one clip becomes probabilities over vi/en/zh;
this runs it over every full turn and every prefix at the partial cadence,
times each call, and writes `<arm>.scores.jsonl` + `<arm>.meta.json` in the
shape `lid_bench.run_data` reads. Full turns run first and one at a time, so
their latency is a clean A7 number.
"""

from __future__ import annotations

import json
import resource
import time
from collections.abc import Callable
from pathlib import Path

import numpy as np

from lid_bench.audio import TARGET_RATE, read_wav
from lid_bench.manifest import LANGUAGES, load
from lid_bench.sidecar import speech_ms

BENCH_ROOT = Path(__file__).resolve().parents[1]
FULL_KEY = "+".join(sorted(LANGUAGES))
ProbsFn = Callable[[np.ndarray], dict[str, float]]


def restrict(probs: dict[str, float]) -> dict[str, float]:
    """A model's distribution over its own label set, masked to vi/en/zh.

    Masking (renormalising the three) is what the sidecar would do with a
    many-language model and a declared candidate set; a label outside the
    three is information the product cannot use."""
    picked = {lang: float(probs.get(lang, 0.0)) for lang in LANGUAGES}
    total = sum(picked.values())
    return {k: (v / total if total > 0 else 1.0 / len(LANGUAGES)) for k, v in picked.items()}


def rss_mib() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def run(arm: str, probs_fn: ProbsFn, manifest: Path, out: Path, prefixes: list[int], meta: dict,
        baseline_mib: float) -> None:
    """`baseline_mib`: `rss_mib()` taken before the arm built its model.

    Rows go to `<arm>.scores.partial.jsonl` a turn at a time and the file is
    renamed when every turn is in, so a run killed part-way (a reboot cost one
    of 8 h) resumes where it stopped instead of starting over. A turn's rows are
    written together: a partial file never holds half a turn."""
    turns = load(manifest)
    out.mkdir(parents=True, exist_ok=True)
    partial = out / f"{arm}.scores.partial.jsonl"
    done = _complete_turns(partial)
    with partial.open("a", encoding="utf-8") as fh:
        for turn in turns:
            if turn.id in done:
                continue
            samples = read_wav(BENCH_ROOT / turn.audio)
            clips = [(None, samples)] + [(ms, samples[: int(ms * TARGET_RATE / 1000)]) for ms in prefixes
                                         if int(ms * TARGET_RATE / 1000) < len(samples)]
            rows = []
            for prefix_ms, clip in clips:
                started = time.perf_counter()
                probs = restrict(probs_fn(clip))
                latency = (time.perf_counter() - started) * 1000
                rows.append({"id": turn.id, "prefix_ms": prefix_ms, "speech_ms": speech_ms(clip),
                             "probs": {FULL_KEY: probs}, "latency_ms": round(latency, 2)})
            fh.write("".join(json.dumps(row) + "\n" for row in rows))
            fh.flush()
    partial.rename(out / f"{arm}.scores.jsonl")
    peak = rss_mib()
    meta = {"arm": arm, **meta, "rss_peak_mib": round(peak, 1), "rss_delta_mib": round(peak - baseline_mib, 1)}
    if done:
        meta["notes"] = [*meta.get("notes", []), f"resumed after {len(done)} turns"]
    (out / f"{arm}.meta.json").write_text(json.dumps(meta, indent=2) + "\n")


def _complete_turns(partial: Path) -> set[str]:
    """Turn ids already in `partial`. A torn last line (killed mid-write) is cut off."""
    if not partial.exists():
        return set()
    text = partial.read_text(encoding="utf-8")
    if text and not text.endswith("\n"):
        text = text[: text.rfind("\n") + 1]
        partial.write_text(text, encoding="utf-8")
    return {json.loads(line)["id"] for line in text.splitlines()}


def write_parity(arm: str, out: Path, report: dict) -> None:
    (out / f"{arm}.parity.json").write_text(json.dumps(report, indent=2) + "\n")
