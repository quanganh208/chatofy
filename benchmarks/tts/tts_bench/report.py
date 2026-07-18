"""Aggregate results/{tag}/{engine}.jsonl into the TTS results report.

Structure mirrors the STT report: environment header, per-engine table,
decision matrix (p95 <= 2s per sentence), run variance, decode params, plus
an A/B listening section filled in manually after the user's verdict.
"""

import json
import platform
from pathlib import Path

import psutil

from .measure import latency_stats

P95_TARGET_S = 2.0
ENGINE_LICENSES = {
    "sherpa-kokoro-en": "Apache-2.0",
    "sherpa-piper-en": "MIT (voice: lessac, permissive)",
}


def load_engine_results(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        lines = [json.loads(line) for line in f if line.strip()]
    header = lines[0]
    if header.get("type") != "header":
        raise ValueError(f"{path}: first record is not a header")
    rows = [r for r in lines[1:] if r.get("type") == "sentence"]
    proc_times = [r["proc_s"] for r in rows]
    total_audio_s = sum(r["audio_s"] for r in rows)
    if not rows or total_audio_s <= 0:
        raise ValueError(f"{path}: no usable sentence rows (rows={len(rows)}, audio={total_audio_s})")
    return {
        "engine": header["engine"],
        "load_s": header["load_s"],
        "peak_rss_mb": header["peak_rss_mb"],
        "decode_params": header["decode_params"],
        "num_sentences": len(rows),
        "rtf_pooled": sum(proc_times) / total_audio_s,
        "latency": latency_stats(proc_times),
        "avg_audio_s": total_audio_s / len(rows),
    }


def collect_runs(results_root: Path) -> dict[str, dict[str, dict]]:
    runs: dict[str, dict[str, dict]] = {}
    for tag_dir in sorted(p for p in results_root.iterdir() if p.is_dir()):
        for result_file in sorted(tag_dir.glob("*.jsonl")):
            agg = load_engine_results(result_file)
            runs.setdefault(tag_dir.name, {})[agg["engine"]] = agg
    return runs


def render_report(results_root: Path) -> str:
    runs = collect_runs(results_root)
    if not runs:
        raise RuntimeError(f"no results under {results_root}")
    primary_tag = sorted(runs)[0]
    primary = sorted(runs[primary_tag].values(), key=lambda a: a["latency"]["p95_s"])

    out = [
        "# TTS EN CPU Benchmark Results — Kokoro-82M vs Piper (sherpa-onnx)",
        "",
        f"Primary run: `{primary_tag}` | Plan: `plans/260718-1933-tts-en-cpu-benchmark/`",
        "Research context: `plans/reports/brainstorm-260718-1933-local-cpu-tts-en-report.md`",
        "",
        "## Environment",
        "",
        f"- CPU: {platform.processor()} — {psutil.cpu_count(logical=False)} physical"
        f" / {psutil.cpu_count()} logical cores",
        f"- RAM: {psutil.virtual_memory().total / (1024**3):.0f} GB",
        f"- OS: {platform.system()} {platform.version()}",
        f"- Python: {platform.python_version()}; CPU-only; sherpa-onnx OfflineTts",
        "- Timing: per-sentence wall time, 1 untimed warmup; engines sequential in"
        " isolated subprocesses; RTF = synth time / generated audio duration",
        "",
        f"## Results ({primary[0]['num_sentences']} sentences, 5-20 words)",
        "",
        "| Engine | Latency mean s | p50 s | p95 s | RTF (pooled) | Avg audio s | Peak RAM MB | Load s |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for agg in primary:
        lat = agg["latency"]
        out.append(
            f"| {agg['engine']} | {lat['mean_s']:.2f} | {lat['p50_s']:.2f} "
            f"| {lat['p95_s']:.2f} | {agg['rtf_pooled']:.3f} | {agg['avg_audio_s']:.1f} "
            f"| {agg['peak_rss_mb']:.0f} | {agg['load_s']:.2f} |"
        )
    out += [
        "",
        f"## Decision Matrix (target: p95 <= {P95_TARGET_S:.0f}s per sentence)",
        "",
        "| Engine | p95 pass | License |",
        "|---|---|---|",
    ]
    for agg in primary:
        p95_pass = "PASS" if agg["latency"]["p95_s"] <= P95_TARGET_S else "FAIL"
        out.append(f"| {agg['engine']} | {p95_pass} | {ENGINE_LICENSES.get(agg['engine'], '?')} |")

    tags = sorted(runs)
    out += ["", "## Run Variance (pooled RTF per run)", ""]
    if len(tags) < 2:
        out.append("Single run only — variance check pending second run.")
    else:
        out += ["| Engine | " + " | ".join(tags) + " | delta % |", "|---|" + "---|" * (len(tags) + 1)]
        for engine_id in sorted({e for t in tags for e in runs[t]}):
            rtfs = [runs[t][engine_id]["rtf_pooled"] for t in tags if engine_id in runs[t]]
            if len(rtfs) < 2:
                continue
            delta_pct = (max(rtfs) - min(rtfs)) / min(rtfs) * 100
            out.append(
                f"| {engine_id} | " + " | ".join(f"{v:.4f}" for v in rtfs) + f" | {delta_pct:.1f} |"
            )

    out += ["", "## Decode Parameters", ""]
    for agg in sorted(primary, key=lambda a: a["engine"]):
        out.append(f"- `{agg['engine']}`: {json.dumps(agg['decode_params'], ensure_ascii=False)}")
    out += [
        "",
        "## A/B Listening Verdict",
        "",
        "_Pending — filled in after the user compares"
        " `results/<tag>/wav/<engine>/` samples._",
        "",
        "## Notes",
        "",
        "- Sentence set: benchmarks/tts/data/sentences-en.txt (30 conversational"
        " translation-style sentences, committed for reproducibility).",
        "- Latency is the UX-relevant metric for the turn-based pipeline; RTF"
        " normalizes across engines' different speaking rates.",
        "",
    ]
    return "\n".join(out)
