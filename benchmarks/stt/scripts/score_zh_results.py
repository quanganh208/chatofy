"""Score the Mandarin arms: per set, per engine CER + timing + RSS + punctuation.

Reads results/{tag}/{engine}.jsonl for the given run tags (read-only; nothing
under results/ is written) and prints a markdown table per set.

CER uses `normalize_text(language="zh")`: NFKC, digits read as spoken Mandarin
numerals on BOTH sides, all whitespace and punctuation removed.
`CER clean` repeats it on the utterances whose reference has no ASCII digit and
no Latin letter — the rows where the written reference may not say what the
speaker said (a parenthesised English name, a typeset number).

    uv run python scripts/score_zh_results.py r11-zh-fleurs r11-zh-aishell

A tag may also hold `streaming-arms/commit_probe.py` output (rows with no
`type`): those are scored on their whole-clip `final_hypothesis` against
`reference`, with RTF from `final_decode_ms`, one row per file and the mean
CER across files — the sidecar's accuracy measured over HTTP.

    uv run python scripts/score_zh_results.py r12-zh-sidecar
"""

import math
import re
import sys
import unicodedata
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from stt_bench.metrics import corpus_cer  # noqa: E402
from stt_bench.report import load_engine_results  # noqa: E402

_LATIN_OR_DIGIT_RE = re.compile(r"[0-9A-Za-z]")


def _is_punct(ch: str) -> bool:
    return unicodedata.category(ch).startswith("P")


def _utterances(path: Path) -> list[dict]:
    import json

    with open(path, encoding="utf-8") as f:
        return [r for r in map(json.loads, filter(str.strip, f)) if r["type"] == "utterance"]


def score_file(path: Path) -> dict:
    agg = load_engine_results(path)
    utts = _utterances(path)
    clean = [u for u in utts if not _LATIN_OR_DIGIT_RE.search(unicodedata.normalize("NFKC", u["ref_text"]))]
    hyps = [u["hyp_text"] for u in utts]
    return {
        **agg,
        "cer_clean": corpus_cer([u["ref_text"] for u in clean], [u["hyp_text"] for u in clean], language="zh"),
        "n_clean": len(clean),
        "hyp_with_punct": sum(any(_is_punct(c) for c in h) for h in hyps),
        "punct_marks": sum(_is_punct(c) for h in hyps for c in h),
        "hyp_with_digit": sum(bool(re.search(r"[0-9]", h)) for h in hyps),
        "empty_hyps": sum(not h.strip() for h in hyps),
    }


#: `commit_probe.py` opens every clip with this much silence (capture-pump.ts
#: PRE_ROLL_MS), and the final decode reads it too.
PROBE_PRE_ROLL_S = 0.32


def _probe_rows(path: Path) -> list[dict] | None:
    """The rows of a `commit_probe.py` file, or None when `path` is a harness file."""
    import json

    with open(path, encoding="utf-8") as f:
        rows = [json.loads(line) for line in f if line.strip()]
    if not rows or any("type" in row or "final_hypothesis" not in row for row in rows):
        return None
    return rows


def _nearest_rank(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, math.ceil(len(ordered) * q) - 1))]


def score_probe(path: Path, rows: list[dict]) -> dict:
    refs = [row["reference"] for row in rows]
    hyps = [row["final_hypothesis"] for row in rows]
    clean = [
        row for row in rows
        if not _LATIN_OR_DIGIT_RE.search(unicodedata.normalize("NFKC", row["reference"]))
    ]
    decode_s = [row["final_decode_ms"] / 1000 for row in rows if "final_decode_ms" in row]
    audio_s = [row["audio_seconds"] + PROBE_PRE_ROLL_S for row in rows if "final_decode_ms" in row]
    return {
        "set": path.stem,
        "n": len(rows),
        "cer": corpus_cer(refs, hyps, language="zh"),
        "cer_clean": corpus_cer(
            [row["reference"] for row in clean], [row["final_hypothesis"] for row in clean], language="zh"
        ),
        "n_clean": len(clean),
        "rtf": sum(decode_s) / sum(audio_s) if decode_s else None,
        "p50": _nearest_rank(decode_s, 0.5) if decode_s else None,
        "p95": _nearest_rank(decode_s, 0.95) if decode_s else None,
        "empty": sum(not h.strip() for h in hyps),
    }


def print_probe_table(scores: list[dict]) -> None:
    print("| Set | n | CER | CER clean (n) | RTF | final p50 s | final p95 s | empty |")
    print("|---|---|---|---|---|---|---|---|")
    for s in scores:
        timing = (
            f"{s['rtf']:.4f} | {s['p50']:.3f} | {s['p95']:.3f}" if s["rtf"] is not None else "– | – | –"
        )
        print(
            f"| {s['set']} | {s['n']} | {s['cer']:.2%} | {s['cer_clean']:.2%} ({s['n_clean']}) "
            f"| {timing} | {s['empty']} |"
        )
    print(f"\nMean CER across sets: {sum(s['cer'] for s in scores) / len(scores):.2%}")


def main() -> int:
    tags = sys.argv[1:]
    if not tags:
        print(__doc__, file=sys.stderr)
        return 1
    for tag in tags:
        tag_dir = BENCH_ROOT / "results" / tag
        files = sorted(tag_dir.glob("*.jsonl"))
        if not files:
            print(f"[error] no results in {tag_dir}", file=sys.stderr)
            return 1
        print(f"\n### {tag}\n")
        probes = [(path, _probe_rows(path)) for path in files]
        if all(rows is not None for _path, rows in probes):
            print_probe_table([score_probe(path, rows) for path, rows in probes])
            continue
        print("| Engine | n | CER | CER clean (n) | RTF | p50 s | p95 s | Peak RSS MB | Load s | hyps w/ punct | marks | hyps w/ digits | empty |")
        print("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for path in files:
            s = score_file(path)
            print(
                f"| {s['engine']} | {s['num_utts']} | {s['cer']:.2%} | {s['cer_clean']:.2%} ({s['n_clean']}) "
                f"| {s['rtf_mean']:.4f} | {s['latency']['p50_s']:.3f} | {s['latency']['p95_s']:.3f} "
                f"| {s['peak_rss_mb']:.0f} | {s['load_s']:.2f} | {s['hyp_with_punct']}/{s['num_utts']} "
                f"| {s['punct_marks']} | {s['hyp_with_digit']} | {s['empty_hyps']} |"
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
