"""Score the Mandarin arms: per set, per engine CER + timing + RSS + punctuation.

Reads results/{tag}/{engine}.jsonl for the given run tags (read-only; nothing
under results/ is written) and prints a markdown table per set.

CER uses `normalize_text(language="zh")`: NFKC, digits read as spoken Mandarin
numerals on BOTH sides, all whitespace and punctuation removed.
`CER clean` repeats it on the utterances whose reference has no ASCII digit and
no Latin letter — the rows where the written reference may not say what the
speaker said (a parenthesised English name, a typeset number).

    uv run python scripts/score_zh_results.py r11-zh-fleurs r11-zh-aishell
"""

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
