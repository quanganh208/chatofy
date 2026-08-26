"""Aggregate results/{run_tag}/{engine}.jsonl into the markdown results report.

Report structure: environment header, per-language comparison tables, decision
matrix vs the RTF <= 0.3 / <= 2s-per-utterance targets, and per-run-tag RTF
variance when two run tags exist.
"""

import json
import platform
from pathlib import Path

import psutil

from .metrics import corpus_cer, corpus_wer, latency_stats

RTF_TARGET = 0.3
# License facts carried from the brainstorm research report; surfaced in the
# decision matrix because they gate commercialization, not the thesis demo.
ENGINE_LICENSES = {
    "sherpa-zipformer-vi": "CC-BY-NC-ND-4.0 (academic only)",
    "sherpa-moonshine-en": "MIT",
    "fw-phowhisper-vi": "BSD-3-Clause",
    "fw-whisper-small-en": "MIT",
    "elevenlabs-vi": "commercial API",
    "elevenlabs-en": "commercial API",
}


def load_engine_results(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        lines = [json.loads(line) for line in f if line.strip()]
    header = lines[0]
    utts = [r for r in lines[1:] if r["type"] == "utterance"]
    proc_times = [u["proc_s"] for u in utts]
    total_audio_s = sum(u["audio_s"] for u in utts)
    return {
        "engine": header["engine"],
        "lang": header["lang"],
        "is_cloud": header.get("is_cloud", False),
        "load_s": header["load_s"],
        "peak_rss_mb": header["peak_rss_mb"],
        "decode_params": header["decode_params"],
        "num_utts": len(utts),
        "wer": corpus_wer([u["ref_text"] for u in utts], [u["hyp_text"] for u in utts]),
        "cer": corpus_cer([u["ref_text"] for u in utts], [u["hyp_text"] for u in utts]),
        "rtf_mean": sum(proc_times) / total_audio_s,
        "latency": latency_stats(proc_times),
    }


def collect_runs(results_root: Path) -> dict[str, dict[str, dict]]:
    """{run_tag: {engine_id: aggregated}} for every results/{tag}/{engine}.jsonl."""
    runs: dict[str, dict[str, dict]] = {}
    for tag_dir in sorted(p for p in results_root.iterdir() if p.is_dir()):
        for result_file in sorted(tag_dir.glob("*.jsonl")):
            agg = load_engine_results(result_file)
            runs.setdefault(tag_dir.name, {})[agg["engine"]] = agg
    return runs


def _environment_section() -> list[str]:
    return [
        "## Environment",
        "",
        f"- CPU: {platform.processor()} — {psutil.cpu_count(logical=False)} physical"
        f" / {psutil.cpu_count()} logical cores",
        f"- RAM: {psutil.virtual_memory().total / (1024**3):.0f} GB",
        f"- OS: {platform.system()} {platform.version()}",
        f"- Python: {platform.python_version()}; CPU-only, no GPU used",
        "- Timing: per-utterance wall time, 1 untimed warmup per engine;"
        " engines run sequentially in isolated subprocesses",
        "",
    ]


def _lang_table(engines: list[dict]) -> list[str]:
    lines = [
        "| Engine | WER % | CER % | RTF (pooled) | Latency p50 s | p95 s | Peak RAM MB | Load s |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for agg in sorted(engines, key=lambda a: a["rtf_mean"]):
        rtf_label = f"{agg['rtf_mean']:.3f}" + (" (incl. network)" if agg["is_cloud"] else "")
        lines.append(
            f"| {agg['engine']} | {agg['wer'] * 100:.2f} | {agg['cer'] * 100:.2f} | {rtf_label} "
            f"| {agg['latency']['p50_s']:.2f} | {agg['latency']['p95_s']:.2f} "
            f"| {agg['peak_rss_mb']:.0f} | {agg['load_s']:.2f} |"
        )
    lines.append("")
    return lines


def _decision_matrix(engines: list[dict]) -> list[str]:
    lines = [
        "## Decision Matrix (targets: RTF <= 0.3, p95 <= 2s per utterance)",
        "",
        "| Engine | Lang | RTF pass | p95 pass | License |",
        "|---|---|---|---|---|",
    ]
    for agg in sorted(engines, key=lambda a: (a["lang"], a["rtf_mean"])):
        if agg["is_cloud"]:
            rtf_pass = "n/a (network)"
        else:
            rtf_pass = "PASS" if agg["rtf_mean"] <= RTF_TARGET else "FAIL"
        p95_pass = "PASS" if agg["latency"]["p95_s"] <= 2.0 else "FAIL"
        license_note = ENGINE_LICENSES.get(agg["engine"], "?")
        lines.append(
            f"| {agg['engine']} | {agg['lang']} | {rtf_pass} | {p95_pass} | {license_note} |"
        )
    lines.append("")
    return lines


def _variance_section(runs: dict[str, dict[str, dict]]) -> list[str]:
    tags = sorted(runs)
    if len(tags) < 2:
        return ["## Run Variance", "", "Single run only — variance check pending second run.", ""]
    lines = ["## Run Variance (pooled RTF per run)", "", "| Engine | " + " | ".join(tags) + " | delta % |", "|---|" + "---|" * (len(tags) + 1)]
    engine_ids = sorted({e for tag in tags for e in runs[tag]})
    for engine_id in engine_ids:
        rtfs = [runs[tag][engine_id]["rtf_mean"] for tag in tags if engine_id in runs[tag]]
        if len(rtfs) < 2:
            continue
        delta_pct = (max(rtfs) - min(rtfs)) / min(rtfs) * 100
        cells = " | ".join(f"{v:.4f}" for v in rtfs)
        lines.append(f"| {engine_id} | {cells} | {delta_pct:.1f} |")
    lines.append("")
    return lines


def render_report(results_root: Path) -> str:
    runs = collect_runs(results_root)
    if not runs:
        raise RuntimeError(f"no results under {results_root}")
    primary_tag = sorted(runs)[0]
    primary = list(runs[primary_tag].values())

    out: list[str] = [
        "# STT CPU Benchmark Results — vi + en, local vs cloud",
        "",
        f"Primary run: `{primary_tag}`",
        "Research context and recorded decision: `docs/development-journey.md`",
        "",
    ]
    out += _environment_section()
    for lang in ("vi", "en"):
        lang_engines = [a for a in primary if a["lang"] == lang]
        if lang_engines:
            out += [f"## Results — {lang} ({lang_engines[0]['num_utts']} utterances)", ""]
            out += _lang_table(lang_engines)
    out += _decision_matrix(primary)
    out += _variance_section(runs)
    out += ["## Decode Parameters", ""]
    for agg in sorted(primary, key=lambda a: a["engine"]):
        out.append(f"- `{agg['engine']}`: {json.dumps(agg['decode_params'], ensure_ascii=False)}")
    out += [
        "",
        "## Notes",
        "",
        "- WER + CER share one normalization: NFC, lowercase, punctuation stripped,"
        " diacritics kept; numbers as written (spoken-vs-digit mismatches count as"
        " errors).",
        "- Read CER next to WER on vi. A hypothesis off by one diacritic costs WER a"
        " whole word, the same as an unrelated word would; CER separates that"
        " near-miss from a real miss. Spaces count as characters, so word-boundary"
        " errors are not free.",
        "- vi test set: VIVOS test subset (CC BY-NC-SA 4.0, measurement only);"
        " en: LibriSpeech test-clean subset (CC BY 4.0). Seed 42.",
        "- Cloud rows measure wall latency including network; not an RTF.",
        "",
    ]
    return "\n".join(out)
