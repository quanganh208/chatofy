"""Render the speed report from whatever result files are on disk.

Keyed on (engine, voice, sentence set) — not on engine alone, as the harness
this was vendored from does, which would collapse four arms into two rows and
two sentence sets into one.

Both run tags are shown side by side rather than averaged, because the spread
between them IS the significance guard for latency: two arms whose r1/r2 ranges
overlap have not separated. (That guard does not transfer to WER, which is
scored separately — synthesis is seeded and the ASR decodes greedily, so a
second tag re-transcribes identical audio and would manufacture separation from
nothing.)
"""

import json
from collections import defaultdict
from pathlib import Path

from .measure import latency_stats


def load_arm(path: Path) -> dict:
    """Parse one arm's result file.

    Returns a `{"broken": ...}` marker rather than None for a file that cannot
    be summarised. Dropping it silently would let `render_report` produce a
    clean-looking report over exactly the arms that `--check-complete` would
    have rejected — the failure mode this harness exists to make impossible.
    """
    try:
        rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines()
                if l.strip()]
    except (OSError, ValueError) as exc:
        return {"broken": f"{path.name}: unreadable ({exc})"}
    header = next((r for r in rows if r["type"] == "header"), None)
    footer = next((r for r in rows if r["type"] == "footer"), None)
    sentences = [r for r in rows if r["type"] == "sentence"]
    if header is None:
        return {"broken": f"{path.name}: no header row"}
    if not sentences:
        return {"broken": f"{path.name}: header but no sentences"}

    proc = [r["proc_s"] for r in sentences]
    total_audio = sum(r["audio_s"] for r in sentences)
    total_words = sum(r["n_words"] for r in sentences)
    streamed = [r for r in sentences if r.get("stream_ttfa_s") is not None]

    def med(vals):
        return sorted(vals)[len(vals) // 2] if vals else None

    return {
        "engine": header["engine"],
        "voice": header["voice"],
        "voice_slug": header["voice_slug"],
        "gender": header["gender"],
        "sentence_set": header["sentence_set"],
        "load_s": header["load_s"],
        "sample_rate": header["sample_rate"],
        "peak_rss_mb": footer["peak_rss_mb"] if footer else None,
        "complete": footer is not None and len(sentences) == header["num_sentences_expected"],
        "n": len(sentences),
        "n_expected": header["num_sentences_expected"],
        "latency": latency_stats(proc),
        "rtf_pooled": sum(proc) / total_audio if total_audio else None,
        "latency_s_per_word": sum(proc) / total_words if total_words else None,
        "audio_s_per_word": total_audio / total_words if total_words else None,
        "ttfa_whole_med": med([r["ttfa_whole_s"] for r in sentences]),
        "ttfa_clause_med": med([r["ttfa_clause_split_s"] for r in sentences]),
        "ttfa_stream_med": med([r["stream_ttfa_s"] for r in streamed]),
        "underrun_med": med([r["stream_underrun_margin_s"] for r in streamed
                             if r.get("stream_underrun_margin_s") is not None]),
        "underrun_worst": max([r["stream_underrun_margin_s"] for r in streamed
                               if r.get("stream_underrun_margin_s") is not None],
                              default=None),
        # What a listener actually waits for before audio can play without a
        # gap: first chunk, plus however far the stream then fell behind.
        # Reporting the first chunk alone credits an engine for sound it cannot
        # sustain.
        "effective_start_med": med([
            r["stream_ttfa_s"] + max(0.0, r.get("stream_underrun_margin_s") or 0.0)
            for r in streamed
        ]),
        "environment": header.get("environment", {}),
    }


def collect(results_root: Path) -> tuple[dict, list[str]]:
    """({(engine, voice_slug, set): {tag: arm}}, [unparseable files])"""
    runs: dict = defaultdict(dict)
    broken: list[str] = []
    for tag_dir in sorted(p for p in results_root.iterdir() if p.is_dir()):
        for path in sorted(tag_dir.glob("*.jsonl")):
            if path.name == "intelligibility.jsonl":
                continue
            arm = load_arm(path)
            if "broken" in arm:
                broken.append(f"{tag_dir.name}/{arm['broken']}")
                continue
            runs[(arm["engine"], arm["voice_slug"], arm["sentence_set"])][tag_dir.name] = arm
    return runs, broken


def _fmt(value, spec=".3f", scale=1.0):
    return "—" if value is None else format(value * scale, spec)


def render_report(results_root: Path) -> str:
    runs, broken = collect(results_root)
    if not runs:
        return "# TTS-vi speed report\n\nNo results.\n"

    any_arm = next(iter(next(iter(runs.values())).values()))
    env = any_arm["environment"]
    out = [
        "# Vietnamese TTS speed report — ZeroTTS vs VieNeu v3 Turbo",
        "",
        "Generated by `run_benchmark.py --render-only`. Numbers only; the verdict,",
        "the vendor-claim reconciliation and the caveats live in `report.md`.",
        "",
        "## Measurement conditions",
        "",
        f"- OS: **{env.get('os')} {env.get('os_release')}** ({env.get('machine')})",
        f"- Python {env.get('python')}, onnxruntime {env.get('onnxruntime')}",
        f"- Threads per engine: **{env.get('threads')}**, both engines, both sessions",
        f"- `HF_HUB_OFFLINE`: {env.get('hf_hub_offline')} — no network call inside a timed section",
        "",
        "> Every earlier measurement recorded in `docs/development-journey.md` was taken",
        "> on **Windows 11** on this same CPU. This harness runs on Linux, which is the",
        "> first thing to suspect when a figure here disagrees with one recorded there.",
        "",
    ]

    if broken:
        out += ["> **UNREADABLE RESULT FILES — this report is missing arms.**", ""]
        out += [f"> - {b}" for b in broken] + [""]

    incomplete = [k for k, tags in runs.items()
                  for t, a in tags.items() if not a["complete"]]
    if incomplete:
        out += ["> **INCOMPLETE RUN — these figures are not reportable.**", ""]
        for engine, voice, set_name in incomplete:
            out.append(f"> - {engine} / {voice} / {set_name}")
        out.append("")

    for set_name in sorted({k[2] for k in runs}):
        out += [f"## Sentence set: `{set_name}`", ""]
        out += [
            "| arm | tag | n | p50 s | p95 s | latency/word | audio/word | RTF | load s | peak MB |",
            "| --- | --- | -: | -: | -: | -: | -: | -: | -: | -: |",
        ]
        for key in sorted(k for k in runs if k[2] == set_name):
            engine, voice, _ = key
            for tag in sorted(runs[key]):
                a = runs[key][tag]
                out.append(
                    f"| {engine} / {voice} | {tag} | {a['n']} | "
                    f"{_fmt(a['latency']['p50_s'])} | {_fmt(a['latency']['p95_s'])} | "
                    f"{_fmt(a['latency_s_per_word'])} | {_fmt(a['audio_s_per_word'])} | "
                    f"{_fmt(a['rtf_pooled'])} | {_fmt(a['load_s'], '.2f')} | "
                    f"{_fmt(a['peak_rss_mb'], '.0f')} |"
                )
        out.append("")

        out += [
            "### Time to first audio (median, ms)",
            "",
            "`clause-split` is what the app waits for today — it splits translated text",
            "in front of the engine. That column, not `whole`, is the incumbent baseline",
            "a streaming challenger has to beat.",
            "",
            "| arm | tag | whole | clause-split | streamed (first chunk) | underrun median | underrun worst | **gapless start** |",
            "| --- | --- | -: | -: | -: | -: | -: | -: |",
        ]
        for key in sorted(k for k in runs if k[2] == set_name):
            engine, voice, _ = key
            for tag in sorted(runs[key]):
                a = runs[key][tag]
                out.append(
                    f"| {engine} / {voice} | {tag} | "
                    f"{_fmt(a['ttfa_whole_med'], '.0f', 1000)} | "
                    f"{_fmt(a['ttfa_clause_med'], '.0f', 1000)} | "
                    f"{_fmt(a['ttfa_stream_med'], '.0f', 1000)} | "
                    f"{_fmt(a['underrun_med'], '+.0f', 1000)} | "
                    f"{_fmt(a['underrun_worst'], '+.0f', 1000)} | "
                    f"**{_fmt(a['effective_start_med'], '.0f', 1000)}** |"
                )
        out += [
            "",
            "A **positive** underrun margin means the stream fell behind playback: the",
            "listener ran out of audio and heard a gap. A fast first chunk with a positive",
            "margin is not a win, and reporting the first chunk alone would hide it.",
            "",
            "**`gapless start` is the column to compare against `clause-split`.** It is the",
            "first chunk plus the worst the stream then fell behind — i.e. how long a",
            "player must buffer before it can run to the end without stalling. The",
            "first-chunk figure is what a vendor quotes; this is what a listener waits for.",
            "",
        ]

    return "\n".join(out) + "\n"
