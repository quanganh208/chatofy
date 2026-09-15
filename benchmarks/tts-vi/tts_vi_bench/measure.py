"""Measurement utilities — latency stats, peak-RSS sampling, sentence loading.

Self-contained copies of the patterns proven in benchmarks/tts (which in turn
copied them from benchmarks/stt): the benchmark projects stay independent on
purpose so any one can be deleted or evolved without breaking the others.

One deliberate divergence from the copy in benchmarks/tts: `load_sentences`
reads JSONL and takes each row's own `id`, where the original parses plain text
and assigns ids positionally. That harness measured one sentence set, so
positional ids were unambiguous. This one measures two, into one results tree —
positional ids would make conversational `s001` and VIVOS `s001` collide on
filename and silently overwrite each other's audio.
"""

import json
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import psutil

BENCH_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = BENCH_ROOT / "models"

#: The RNG seed both engines synthesize under. Arbitrary value, deliberately
#: recorded in every result header.
#:
#: It lives here rather than in one engine module because both engines need the
#: same one: each draws from the *global* numpy RNG and neither exposes a seed
#: parameter, so "seeded" means `np.random.seed` immediately before the call.
#: Seeding only one of two compared engines is what made the incumbent look
#: unreliable and the challenger look solid in the first run of this benchmark.
SEED = 20260914


def bench_threads() -> int:
    """CPU threads per engine; TTS_VI_BENCH_THREADS env, default 8.

    8 is the physical core count of the measurement machine. The sidecar records
    that 8 beat 16 hyperthreads there, and matching it is what lets these
    numbers transfer to the running service.
    """
    return int(os.environ.get("TTS_VI_BENCH_THREADS", "8"))


def latency_stats(samples_seconds: list[float]) -> dict[str, float]:
    """Mean / p50 / p95 over per-sentence synthesis times (seconds)."""
    if not samples_seconds:
        raise ValueError("no latency samples")
    arr = np.asarray(samples_seconds, dtype=np.float64)
    return {
        "mean_s": float(arr.mean()),
        "p50_s": float(np.percentile(arr, 50)),
        "p95_s": float(np.percentile(arr, 95)),
    }


class PeakRssSampler:
    """Samples process-tree RSS in a background thread, records the peak."""

    def __init__(self, pid: int | None = None, interval_s: float = 0.1):
        self._process = psutil.Process(pid)
        self._interval_s = interval_s
        self._peak_bytes = 0
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._sample_loop, daemon=True)

    def _tree_rss(self) -> int:
        total = 0
        try:
            total = self._process.memory_info().rss
            for child in self._process.children(recursive=True):
                try:
                    total += child.memory_info().rss
                except psutil.NoSuchProcess:
                    continue
        except psutil.NoSuchProcess:
            pass
        return total

    def _sample_loop(self) -> None:
        while not self._stop_event.is_set():
            self._peak_bytes = max(self._peak_bytes, self._tree_rss())
            time.sleep(self._interval_s)

    def start(self) -> "PeakRssSampler":
        self._peak_bytes = self._tree_rss()
        self._thread.start()
        return self

    def stop(self) -> float:
        """Stop sampling; returns peak RSS in MB."""
        self._stop_event.set()
        self._thread.join(timeout=2)
        self._peak_bytes = max(self._peak_bytes, self._tree_rss())
        return self._peak_bytes / (1024 * 1024)


@dataclass(frozen=True)
class Sentence:
    """One row of a sentence set.

    `text` is synthesized; `ref_text` is what the ASR transcript is scored
    against. They differ only where the set was built from a corpus whose
    reference casing is not what we want to feed an engine — VIVOS is ALL CAPS.
    """

    id: str
    text: str
    ref_text: str
    tags: tuple[str, ...]


def load_sentences(path: Path) -> list[Sentence]:
    """Load a JSONL sentence set, taking each row's declared `id`.

    Blank lines and `#` comment lines are skipped, so a set can carry its policy
    header in the file itself rather than only in the plan.
    """
    sentences: list[Sentence] = []
    seen: set[str] = set()
    with open(path, encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            row = json.loads(line)
            sid = row["id"]
            if sid in seen:
                raise ValueError(f"{path}:{lineno}: duplicate sentence id {sid!r}")
            seen.add(sid)
            if not row["text"].strip() or not row["ref_text"].strip():
                raise ValueError(f"{path}:{lineno}: empty text or ref_text for {sid!r}")
            sentences.append(
                Sentence(
                    id=sid,
                    text=row["text"],
                    ref_text=row["ref_text"],
                    tags=tuple(row.get("tags", ())),
                )
            )
    if not sentences:
        raise ValueError(f"no sentences in {path}")
    return sentences


def sentence_set_name(path: Path) -> str:
    """`data/sentences-vivos.jsonl` -> `vivos`; used in result filenames."""
    stem = Path(path).stem
    return stem[len("sentences-"):] if stem.startswith("sentences-") else stem
