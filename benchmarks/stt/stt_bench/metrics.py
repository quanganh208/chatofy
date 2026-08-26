"""Benchmark metrics: corpus WER + CER, real-time factor, latency stats, peak RSS.

All engines are measured with these exact functions so numbers are comparable.
"""

import threading
import time

import jiwer
import numpy as np
import psutil

from .text_normalize import normalize_text


def corpus_wer(references: list[str], hypotheses: list[str]) -> float:
    """Corpus-level WER over normalized ref/hyp pairs (0.0–1.0+)."""
    if len(references) != len(hypotheses):
        raise ValueError(f"ref/hyp count mismatch: {len(references)} vs {len(hypotheses)}")
    refs = [normalize_text(r) for r in references]
    hyps = [normalize_text(h) for h in hypotheses]
    return jiwer.wer(refs, hyps)


def corpus_cer(references: list[str], hypotheses: list[str]) -> float:
    """Corpus-level CER over normalized ref/hyp pairs (0.0–1.0+).

    Shares `normalize_text` with `corpus_wer`, so the two metrics describe the
    same strings and only differ in edit-unit. Spaces survive normalization and
    are counted as characters, which keeps word-boundary errors visible instead
    of silently free.

    Reported alongside WER because Vietnamese carries meaning in diacritics that
    WER cannot resolve: a hypothesis differing from its reference by one tone
    mark loses the whole word to WER, the same as an unrelated word would. CER
    separates a near-miss from a miss, and is the metric to read when comparing
    engines on vi.
    """
    if len(references) != len(hypotheses):
        raise ValueError(f"ref/hyp count mismatch: {len(references)} vs {len(hypotheses)}")
    refs = [normalize_text(r) for r in references]
    hyps = [normalize_text(h) for h in hypotheses]
    return jiwer.cer(refs, hyps)


def rtf(processing_seconds: float, audio_seconds: float) -> float:
    """Real-time factor: processing time / audio duration. <1.0 = faster than realtime."""
    if audio_seconds <= 0:
        raise ValueError("audio_seconds must be positive")
    return processing_seconds / audio_seconds


def latency_stats(samples_seconds: list[float]) -> dict[str, float]:
    """Mean / p50 / p95 over per-utterance processing times (seconds)."""
    if not samples_seconds:
        raise ValueError("no latency samples")
    arr = np.asarray(samples_seconds, dtype=np.float64)
    return {
        "mean_s": float(arr.mean()),
        "p50_s": float(np.percentile(arr, 50)),
        "p95_s": float(np.percentile(arr, 95)),
    }


class PeakRssSampler:
    """Samples RSS of a process tree in a background thread, records the peak.

    Used around a full engine run (load + inference) in the per-engine
    subprocess so each engine's memory footprint is isolated. Polling at 100ms
    can miss sub-100ms spikes; acceptable for model-weight-dominated footprints.
    """

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
