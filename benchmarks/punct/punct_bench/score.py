"""Score every arm's predictions against the rulers' references.

    uv run python -m punct_bench.score            # results/ -> results/summary.json
    uv run python -m punct_bench.score --smoke    # results/smoke/

Words are aligned by their lowercase form (difflib), so the prod ruler — where
the input is an ASR hypothesis and the reference is Scribe's — is scored only
on the words both sides share. Every count is kept per row so the decision can
be checked with a paired bootstrap over rows rather than read off two means.

Metrics, per arm and ruler:
- punct F1 (micro over `.` `,` `?`) and per-mark F1: the mark after a word.
- case F1: whether a word has a capital, against the reference.
- proper nouns: reference words capitalized away from a sentence start,
  reproduced exactly.
- mid-sentence capitals per 1k words: a capital the reference does not have,
  on a word the prediction itself does not open a sentence with — "Anh, Xin".
- AI: reference "ai" words reproduced exactly; false AI: "AI" written where the
  reference has "ai"/"Ai".
- word changes: rows whose letters differ from the input (taggers must not).
  Such a row is scored as prod would serve it: the API drops a restore that
  changed a word (`restoreKeepsWords`) and shows the floor instead, so the row
  is scored on `floor(input)`. The count is reported beside the scores.
"""
import argparse
import difflib
import json
import random
from collections import Counter
from pathlib import Path

from punct_bench.text import COMMA, PERIOD, QMARK, WORD, model_input, nfc, tokens

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RESULTS = ROOT / "results"
MARKS = (PERIOD, COMMA, QMARK)
PRIMARY_RULERS = ("prod", "fleurs")
INCUMBENT = "dw-mmbert-int8emb"
BOOTSTRAP = 2000


def _has_cap(word: str) -> bool:
    return any(c.isupper() for c in word)


def _starts(seq: list[tuple[str, str]]) -> set[int]:
    """Positions that open a sentence: the first word, and any after `.`/`?`."""
    return {0} | {i + 1 for i, (_, mark) in enumerate(seq) if mark in (PERIOD, QMARK)}


def row_counts(ref: str, pred: str, source: str) -> Counter:
    r, p = tokens(ref), tokens(pred)
    r_starts, p_starts = _starts(r), _starts(p)
    c: Counter = Counter()
    c["rows"] = 1
    c["word_changed"] = int(_letters(pred) != _letters(source))
    if c["word_changed"]:
        p = tokens(floor(source))
        p_starts = _starts(p)
    matcher = difflib.SequenceMatcher(a=[w.lower() for w, _ in r], b=[w.lower() for w, _ in p], autojunk=False)
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            i, j = block.a + k, block.b + k
            (rw, rm), (pw, pm) = r[i], p[j]
            c["words"] += 1
            for mark in MARKS:
                if pm == mark and rm == mark:
                    c[f"tp{mark}"] += 1
                elif pm == mark:
                    c[f"fp{mark}"] += 1
                elif rm == mark:
                    c[f"fn{mark}"] += 1
            rc, pc = _has_cap(rw), _has_cap(pw)
            c["case_tp"] += rc and pc
            c["case_fp"] += pc and not rc
            c["case_fn"] += rc and not pc
            if rc and i not in r_starts:
                c["pn_n"] += 1
                c["pn_ok"] += rw == pw
            if pc and not rc and j not in p_starts:
                c["mid_caps"] += 1
            if rw.lower() == "ai":
                c["ai_n"] += 1
                c["ai_ok"] += rw == pw
                c["false_ai"] += pw == "AI" and rw != "AI"
    return c


def floor(text: str) -> str:
    """What the display shows when a restore is refused: first capital, final stop."""
    return (text[:1].upper() + text[1:] + ".") if text else text


def _letters(text: str) -> str:
    return "".join(WORD.findall(nfc(text).lower()))


def _f1(tp: float, fp: float, fn: float) -> float:
    return 2 * tp / (2 * tp + fp + fn) if tp else 0.0


def metrics(c: Counter) -> dict:
    tp = sum(c[f"tp{m}"] for m in MARKS)
    fp = sum(c[f"fp{m}"] for m in MARKS)
    fn = sum(c[f"fn{m}"] for m in MARKS)
    out = {
        "rows": c["rows"],
        "punct_f1": _f1(tp, fp, fn),
        **{f"f1{m}": _f1(c[f"tp{m}"], c[f"fp{m}"], c[f"fn{m}"]) for m in MARKS},
        "case_f1": _f1(c["case_tp"], c["case_fp"], c["case_fn"]),
        "proper_nouns": f"{c['pn_ok']}/{c['pn_n']}",
        "mid_caps_per_1k": 1000 * c["mid_caps"] / c["words"] if c["words"] else 0.0,
        "ai": f"{c['ai_ok']}/{c['ai_n']}",
        "false_ai": c["false_ai"],
        "word_changed_rows": c["word_changed"],
    }
    return {k: round(v, 4) if isinstance(v, float) else v for k, v in out.items()}


def primary(per_ruler: dict[str, Counter]) -> float:
    """The decision score: mean of case F1 and punct F1 over the speech rulers."""
    values = []
    for name in PRIMARY_RULERS:
        m = metrics(per_ruler[name])
        values += [m["case_f1"], m["punct_f1"]]
    return sum(values) / len(values)


def _latency(ms: list[float]) -> dict:
    ms = sorted(ms)
    pick = lambda q: round(ms[min(len(ms) - 1, int(q * len(ms)))], 1) if ms else None  # noqa: E731
    return {"p50_ms": pick(0.5), "p95_ms": pick(0.95), "max_ms": pick(1.0)}


def load_rows() -> dict[tuple[str, str], dict]:
    rows = {}
    for path in sorted(DATA.glob("rows-*.jsonl")):
        for line in path.open(encoding="utf-8"):
            row = json.loads(line)
            rows[(row["ruler"], row["id"])] = row
    return rows


def score(results: Path, base: str = INCUMBENT) -> dict:
    rows = load_rows()
    arms: dict[str, dict] = {}
    per_row: dict[str, dict[tuple[str, str], Counter]] = {}
    for preds_path in sorted(results.glob("*/preds.jsonl")):
        arm = preds_path.parent.name
        counts: dict[tuple[str, str], Counter] = {}
        latency: dict[str, list[float]] = {}
        errors = 0
        for line in preds_path.open(encoding="utf-8"):
            pred = json.loads(line)
            key = (pred["ruler"], pred["id"])
            errors += "error" in pred
            row = rows[key]
            counts[key] = row_counts(row["ref"], pred["pred"], row["input"])
            latency.setdefault(pred["ruler"], []).append(pred["ms"])
        per_row[arm] = counts
        by_ruler: dict[str, Counter] = {}
        for (ruler, _), c in counts.items():
            by_ruler.setdefault(ruler, Counter()).update(c)
        run = json.loads((preds_path.parent / "run.json").read_text()) if (preds_path.parent / "run.json").exists() else {}
        arms[arm] = {
            "rulers": {name: {**metrics(c), **_latency(latency[name])} for name, c in sorted(by_ruler.items())},
            "primary": round(primary(by_ruler), 4) if all(n in by_ruler for n in PRIMARY_RULERS) else None,
            "errors": errors,
            "peak_rss_mb": run.get("peak_rss_mb"),
            "load_s": run.get("load_s"),
        }
    if base in per_row:
        for arm in arms:
            if arm != base:
                arms[arm]["vs_incumbent"] = paired_bootstrap(per_row[arm], per_row[base])
    return arms


def paired_bootstrap(arm: dict, base: dict) -> dict | None:
    """95% interval of (arm primary − incumbent primary), rows resampled per ruler."""
    keys = {name: sorted(k for k in arm if k[0] == name and k in base) for name in PRIMARY_RULERS}
    if not all(keys.values()):
        return None
    rng = random.Random(7)

    def total(side: dict, picks: dict) -> dict[str, Counter]:
        out = {}
        for name, ks in picks.items():
            c: Counter = Counter()
            for k in ks:
                c.update(side[k])
            out[name] = c
        return out

    point = primary(total(arm, keys)) - primary(total(base, keys))
    diffs = []
    for _ in range(BOOTSTRAP):
        picks = {name: [ks[rng.randrange(len(ks))] for _ in ks] for name, ks in keys.items()}
        diffs.append(primary(total(arm, picks)) - primary(total(base, picks)))
    diffs.sort()
    return {
        "delta": round(point, 4),
        "ci95": [round(diffs[int(0.025 * BOOTSTRAP)], 4), round(diffs[int(0.975 * BOOTSTRAP)], 4)],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--base", default=INCUMBENT, help="arm the bootstrap compares against")
    args = parser.parse_args()
    results = RESULTS / "smoke" if args.smoke else RESULTS
    summary = score(results, args.base)
    if args.base != INCUMBENT:
        # A comparison against another base is a reading, not the record.
        for arm, s in sorted(summary.items()):
            vs = s.get("vs_incumbent")
            if vs:
                print(f"{arm:28s} {s['primary']:.4f} vs {args.base}: {vs['delta']:+.4f} {vs['ci95']}")
        return
    (results / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    header = f"{'arm':22s} {'primary':>7s} {'Δ vs inc [95% CI]':>24s} {'rss':>6s}"
    print(header)
    for arm, s in sorted(summary.items(), key=lambda kv: -(kv[1]["primary"] or 0)):
        vs = s.get("vs_incumbent")
        vs_text = f"{vs['delta']:+.3f} [{vs['ci95'][0]:+.3f},{vs['ci95'][1]:+.3f}]" if vs else "-"
        print(f"{arm:22s} {s['primary'] or 0:7.3f} {vs_text:>24s} {s['peak_rss_mb'] or 0:6}")
    for arm, s in sorted(summary.items()):
        for ruler, m in s["rulers"].items():
            print(
                f"  {arm:20s} {ruler:9s} punct {m['punct_f1']:.3f} (. {m['f1.']:.2f} , {m['f1,']:.2f} ? {m['f1?']:.2f})"
                f" case {m['case_f1']:.3f} pn {m['proper_nouns']:>8s} mid {m['mid_caps_per_1k']:5.1f}"
                f" ai {m['ai']:>6s} fAI {m['false_ai']} chg {m['word_changed_rows']} p50 {m['p50_ms']} p95 {m['p95_ms']}"
            )


if __name__ == "__main__":
    main()
