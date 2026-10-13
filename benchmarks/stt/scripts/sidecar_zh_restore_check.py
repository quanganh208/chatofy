"""Punctuate the recorded Paraformer FLEURS hypotheses through the sidecar's /restore.

    uv run python scripts/sidecar_zh_restore_check.py --url http://localhost:18002 \\
        --out results/r12-zh-restore/restored.jsonl

Reports, over the 50 `r11-zh-fleurs` hypotheses:
- words kept: the restore's words equal the hypothesis's words by the API's own
  rule (`restoreKeepsWords`: each Han character is a word, every other letter or
  digit run is one) — a row that fails is one prod would discard;
- latency p50/p95 of the HTTP call, against the API's 300 ms restore budget;
- punctuation F1 against the FLEURS references, the way `benchmarks/punct`
  scores Vietnamese: the mark after each unit, units aligned with difflib and
  scored only where both sides have the same unit, micro F1 over full stop,
  comma and question mark.

Writes one row per utterance (`utt_id`, `hyp_text`, `restored`, `ref_text`) so
`itn_display_hypotheses.mjs --lang zh` can review the ITN on restored text.
"""
import argparse
import difflib
import json
import math
import re
import sys
import time
import unicodedata
from pathlib import Path

import requests

BENCH = Path(__file__).resolve().parent.parent
SOURCE = BENCH / "results" / "r11-zh-fleurs" / "sherpa-paraformer-zh.jsonl"

PERIOD, COMMA, QMARK = ".", ",", "?"
MARK_OF = {
    **dict.fromkeys("。．.!！", PERIOD),
    **dict.fromkeys("，,、；;：:", COMMA),
    **dict.fromkeys("？?", QMARK),
}
#: The API's `wordsOf`: a Han character, or a run of other letters and digits.
_HAN = "\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff"
UNIT = re.compile(rf"[{_HAN}]|(?:(?![{_HAN}])[^\W_])+")


def units_with_marks(text: str) -> list[tuple[str, str | None]]:
    """Each unit of `text`, lowercased, with the mark that follows it (or None)."""
    text = unicodedata.normalize("NFC", text).lower()
    out: list[tuple[str, str | None]] = []
    at = 0
    for match in UNIT.finditer(text):
        if out:
            between = text[at : match.start()]
            mark = next((MARK_OF[c] for c in between if c in MARK_OF), None)
            out[-1] = (out[-1][0], mark)
        out.append((match.group(0), None))
        at = match.end()
    if out:
        tail = text[at:]
        out[-1] = (out[-1][0], next((MARK_OF[c] for c in tail if c in MARK_OF), None))
    return out


def words_of(text: str) -> list[str]:
    return [unit for unit, _ in units_with_marks(text)]


def punct_counts(reference: str, predicted: str) -> dict[str, int]:
    ref, pred = units_with_marks(reference), units_with_marks(predicted)
    matcher = difflib.SequenceMatcher(
        a=[u for u, _ in ref], b=[u for u, _ in pred], autojunk=False
    )
    tp = fp = fn = 0
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            rm, pm = ref[block.a + k][1], pred[block.b + k][1]
            if pm is not None and pm == rm:
                tp += 1
            else:
                fp += pm is not None
                fn += rm is not None
    return {"tp": tp, "fp": fp, "fn": fn}


def nearest_rank(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, math.ceil(q * len(ordered)) - 1))]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--url", default="http://localhost:8002")
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()

    rows = [json.loads(line) for line in SOURCE.read_text(encoding="utf-8").splitlines() if line.strip()]
    rows = [r for r in rows if r.get("type") == "utterance"]
    out_path = a.out if a.out.is_absolute() else BENCH / a.out
    out_path.parent.mkdir(parents=True, exist_ok=True)

    kept = 0
    latencies: list[float] = []
    totals = {"tp": 0, "fp": 0, "fn": 0}
    with out_path.open("w", encoding="utf-8") as out:
        for row in rows:
            started = time.perf_counter()
            res = requests.post(
                f"{a.url.rstrip('/')}/restore",
                json={"text": row["hyp_text"], "language": "zh"},
                timeout=10,
            )
            latencies.append((time.perf_counter() - started) * 1000)
            if res.status_code != 200:
                print(f"{row['utt_id']}: HTTP {res.status_code} {res.text[:120]}", file=sys.stderr)
                return 2
            restored = res.json()["text"]
            same = words_of(restored) == words_of(row["hyp_text"])
            kept += same
            # Scored as prod would serve it: a restore that changed a word is
            # dropped, and the plain hypothesis (no marks at all) is shown.
            counts = punct_counts(row["ref_text"], restored if same else row["hyp_text"])
            for key in totals:
                totals[key] += counts[key]
            out.write(
                json.dumps(
                    {
                        "utt_id": row["utt_id"],
                        "hyp_text": row["hyp_text"],
                        "restored": restored,
                        "ref_text": row["ref_text"],
                        "words_kept": same,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )

    tp, fp, fn = totals["tp"], totals["fp"], totals["fn"]
    f1 = 2 * tp / (2 * tp + fp + fn) if tp else 0.0
    print(f"utterances        {len(rows)}")
    print(f"words kept        {kept}/{len(rows)}")
    print(f"latency p50/p95   {nearest_rank(latencies, 0.5):.1f} / {nearest_rank(latencies, 0.95):.1f} ms")
    print(f"punctuation F1    {f1:.4f}  (tp {tp}, fp {fp}, fn {fn})")
    print(f"wrote             {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
