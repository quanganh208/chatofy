"""VieNeu-TTS CPU benchmark — RTF, first-audio latency, throughput over a corpus.

Run once per thread setting via the SPIKE_THREADS env var (set before ORT import).
Writes per-sentence wavs to out/ and a metrics table to results-threads-<n>.md.
"""
import os
import statistics
import sys
import time
from pathlib import Path

# Thread knobs must be set BEFORE importing onnxruntime/numpy.
_threads = os.environ.get("SPIKE_THREADS")
if _threads:
    os.environ.setdefault("OMP_NUM_THREADS", _threads)
    os.environ.setdefault("MKL_NUM_THREADS", _threads)

import numpy as np  # noqa: E402
from vieneu import Vieneu  # noqa: E402

HERE = Path(__file__).parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
SR = 48_000


def load_corpus() -> list[str]:
    lines = (HERE / "corpus_vi.txt").read_text(encoding="utf-8").splitlines()
    return [ln.strip() for ln in lines if ln.strip()]


def first_audio_latency(tts, text: str, voice) -> float:
    """Seconds until the first non-empty audio chunk from infer_stream."""
    t0 = time.perf_counter()
    for chunk in tts.infer_stream(text, voice=voice):
        if chunk is not None and len(chunk) > 0:
            return time.perf_counter() - t0
    return float("nan")


def main() -> None:
    label = _threads or "default"
    t0 = time.perf_counter()
    tts = Vieneu(mode="v3turbo")
    load_s = time.perf_counter() - t0

    voices = list(getattr(tts, "_preset_voices", {}).keys())
    voice = getattr(tts, "_default_voice", None) or (voices[0] if voices else None)

    corpus = load_corpus()
    # Warm-up (one-time costs) — excluded from measurements.
    tts.infer("Khởi động hệ thống.", voice=voice)

    rows = []
    total_gen = 0.0
    total_audio = 0.0
    wall0 = time.perf_counter()
    for i, text in enumerate(corpus, 1):
        t1 = time.perf_counter()
        audio = np.asarray(tts.infer(text, voice=voice), dtype=np.float32)
        gen_s = time.perf_counter() - t1
        dur_s = len(audio) / SR
        rtf = gen_s / dur_s if dur_s > 0 else float("nan")
        fal = first_audio_latency(tts, text, voice)
        tts.save(audio, OUT / f"corpus_{i:02d}.wav")
        rows.append((i, len(text), dur_s, gen_s, rtf, fal))
        total_gen += gen_s
        total_audio += dur_s
        print(f"[{i:02d}] chars={len(text):3d} audio={dur_s:5.2f}s gen={gen_s:5.2f}s "
              f"RTF={rtf:5.3f} first_audio={fal:5.2f}s")
    wall_s = time.perf_counter() - wall0

    rtfs = sorted(r[4] for r in rows)
    fals = sorted(r[5] for r in rows if r[5] == r[5])  # drop NaN
    p90 = rtfs[min(len(rtfs) - 1, int(round(0.9 * (len(rtfs) - 1))))]

    print("\n=== SUMMARY (threads=%s) ===" % label)
    print(f"cold-start load : {load_s:.2f}s")
    print(f"RTF  min/median/p90/max : {rtfs[0]:.3f} / {statistics.median(rtfs):.3f} / "
          f"{p90:.3f} / {rtfs[-1]:.3f}")
    if fals:
        print(f"first-audio latency median : {statistics.median(fals):.2f}s")
    print(f"throughput : {total_audio:.1f}s audio in {total_gen:.1f}s gen "
          f"(wall {wall_s:.1f}s incl. streaming pass)")

    # Persist a markdown table.
    md = [f"# Benchmark results — threads={label}", "",
          f"- cold-start load: {load_s:.2f}s",
          f"- RTF min/median/p90/max: {rtfs[0]:.3f} / {statistics.median(rtfs):.3f} / {p90:.3f} / {rtfs[-1]:.3f}",
          f"- first-audio latency median: {statistics.median(fals):.2f}s" if fals else "- first-audio latency: n/a",
          f"- throughput: {total_audio:.1f}s audio / {total_gen:.1f}s gen",
          "", "| # | chars | audio_s | gen_s | RTF | first_audio_s |",
          "|---|-------|---------|-------|-----|---------------|"]
    for (i, c, d, g, r, f) in rows:
        md.append(f"| {i} | {c} | {d:.2f} | {g:.2f} | {r:.3f} | {f:.2f} |")
    (HERE / f"results-threads-{label}.md").write_text("\n".join(md), encoding="utf-8")
    print(f"\n[out] results-threads-{label}.md")


if __name__ == "__main__":
    main()
