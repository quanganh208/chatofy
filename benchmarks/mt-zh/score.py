"""Score one mt-zh run: chrF++, COMET, latency, failures, script checks, tokens.

Runs in the live-translate scorer environment (same sacrebleu and
unbabel-comet pins as `live-translate/score-adequacy.py`), plus OpenCC for the
script check:

    cd benchmarks/live-translate && uv run --with opencc-python-reimplemented \
        python -I ../mt-zh/score.py ../mt-zh/results/<tag>

Writes `<run>/scores.json`; refuses to overwrite an existing one.

chrF++ settings (sacrebleu CHRF: char_order=6, word_order=2, beta=2):
  - vi/en targets: the raw strings, exactly as `score-adequacy.py` does.
  - zh targets: hypothesis and reference first go through sacrebleu's `zh`
    tokenizer (each CJK character becomes its own token; Latin runs stay whole).
    chrF strips whitespace before counting character n-grams, so the character
    part is unchanged by this; what changes is the word-bigram "++" part, which
    on unsegmented Chinese would otherwise see one "word" per sentence.
  - plain chrF (word_order=0, untokenized) is reported alongside for every
    direction as a tokenization-free cross-check.
chrF is never compared across different target languages, only against the
baseline of the same run where the decision rule asks.
"""

from __future__ import annotations

import json
import re
import statistics
import sys
from collections import defaultdict
from pathlib import Path

DIRECTIONS = ["vi_to_zh", "zh_to_vi", "en_to_zh", "zh_to_en", "vi_to_en", "en_to_vi"]
BASELINE = ["vi_to_en", "en_to_vi"]
FLAG_MARGIN = 0.03  # plan.md decision rule: COMET more than 0.03 below baseline mean

# DeepSeek list price per 1M tokens for deepseek-flash, USD, read from
# api-docs.deepseek.com/quick_start/pricing on 2026-10-13.
PRICE = {
    "peak": {"hit": 0.006, "miss": 0.30, "out": 1.20},
    "offpeak": {"hit": 0.003, "miss": 0.15, "out": 0.60},
}

CJK = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
LATIN_WORD = re.compile(r"[A-Za-zÀ-ỹ]{2,}")
VI_DIACRITIC = re.compile(r"[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]")


def load(run: Path) -> dict[str, list[dict]]:
    """The directions the run recorded (meta.json `directions`), all six by default."""
    global DIRECTIONS
    meta = run / "meta.json"
    if meta.exists():
        recorded = json.loads(meta.read_text(encoding="utf-8")).get("directions")
        if recorded:
            DIRECTIONS = [d for d in DIRECTIONS if d in recorded]
    rows: dict[str, list[dict]] = {}
    for direction in DIRECTIONS:
        path = run / f"{direction}.jsonl"
        if not path.exists():
            raise SystemExit(f"missing {path}")
        rows[direction] = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    return rows


def pct(values: list[float], q: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return float("nan")
    k = (len(ordered) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def spread(values: list[float]) -> dict:
    return {
        "mean": statistics.fmean(values),
        "sd": statistics.stdev(values) if len(values) > 1 else 0.0,
        "min": min(values),
        "max": max(values),
        "per_repeat": values,
    }


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    run = Path(sys.argv[1]).resolve()
    out = run / "scores.json"
    if out.exists():
        print(f"{out} exists; never overwritten", file=sys.stderr)
        return 1
    rows = load(run)

    import sacrebleu
    from sacrebleu.tokenizers.tokenizer_zh import TokenizerZh

    tok_zh = TokenizerZh()
    chrf_pp = sacrebleu.CHRF(word_order=2)
    chrf_plain = sacrebleu.CHRF(word_order=0)

    # ---- COMET: score each distinct (src, mt, ref) once, one model load.
    triples: dict[tuple[str, str, str], float] = {}
    for direction in DIRECTIONS:
        for r in rows[direction]:
            triples.setdefault((r["source"], r["hypothesis"], r["reference"]), 0.0)
    from comet import download_model, load_from_checkpoint

    comet = load_from_checkpoint(download_model("Unbabel/wmt22-comet-da"))
    keys = list(triples)
    print(f"COMET on {len(keys)} distinct segments", file=sys.stderr)
    pred = comet.predict(
        [{"src": s, "mt": m, "ref": r} for s, m, r in keys], batch_size=16, gpus=0, progress_bar=False
    )
    for key, score in zip(keys, pred.scores):
        triples[key] = float(score)

    report: dict = {"run": run.name, "directions": {}}
    usage_total = {"hit": 0, "miss": 0, "out": 0, "requests": 0}
    for direction in DIRECTIONS:
        target = direction.split("_to_")[1]
        by_repeat: dict[int, list[dict]] = defaultdict(list)
        for r in rows[direction]:
            by_repeat[r["repeat"]].append(r)
        chrfpp, chrf, comet_means = [], [], []
        for repeat in sorted(by_repeat):
            batch = sorted(by_repeat[repeat], key=lambda r: r["id"])
            hyps = [r["hypothesis"] for r in batch]
            refs = [r["reference"] for r in batch]
            if target == "zh":
                chrfpp.append(chrf_pp.corpus_score([tok_zh(h) for h in hyps], [[tok_zh(x) for x in refs]]).score)
            else:
                chrfpp.append(chrf_pp.corpus_score(hyps, [refs]).score)
            chrf.append(chrf_plain.corpus_score(hyps, [refs]).score)
            comet_means.append(
                statistics.fmean(triples[(r["source"], r["hypothesis"], r["reference"])] for r in batch)
            )

        ok = [r for r in rows[direction] if not r["error"]]
        total = [r["totalMs"] for r in ok]
        ttft = [r["ttftMs"] for r in ok if r["ttftMs"] is not None]
        tokens = {"hit": 0, "miss": 0, "out": 0, "with_usage": 0}
        for r in rows[direction]:
            u = r.get("usage")
            if not u:
                continue
            tokens["with_usage"] += 1
            tokens["hit"] += u.get("prompt_cache_hit_tokens", 0)
            tokens["miss"] += u.get("prompt_cache_miss_tokens", u.get("prompt_tokens", 0))
            tokens["out"] += u.get("completion_tokens", 0)
        for k in ("hit", "miss", "out"):
            usage_total[k] += tokens[k]
        usage_total["requests"] += len(rows[direction])

        # Script and leakage checks over every output of the direction.
        checks: dict = {}
        if target == "zh":
            from opencc import OpenCC

            t2s = OpenCC("t2s")
            trad = [r for r in ok if t2s.convert(r["hypothesis"]) != r["hypothesis"]]
            trad_ref = sum(1 for r in ok if t2s.convert(r["reference"]) != r["reference"])
            latin_extra = [
                r for r in ok
                if len(LATIN_WORD.findall(r["hypothesis"])) > len(LATIN_WORD.findall(r["reference"]))
            ]
            vi_leak = [r for r in ok if VI_DIACRITIC.search(r["hypothesis"])]
            checks = {
                "outputs": len(ok),
                "traditional_chars_outputs": len(trad),
                "traditional_chars_references": trad_ref,
                "traditional_examples": [
                    {"id": r["id"], "repeat": r["repeat"], "hyp": r["hypothesis"]} for r in trad[:5]
                ],
                "more_latin_words_than_reference": len(latin_extra),
                "latin_examples": [
                    {"id": r["id"], "repeat": r["repeat"], "hyp": r["hypothesis"], "ref": r["reference"]}
                    for r in latin_extra[:5]
                ],
                "vietnamese_diacritics_in_output": len(vi_leak),
            }
        else:
            cjk_leak = [r for r in ok if CJK.search(r["hypothesis"])]
            checks = {
                "outputs": len(ok),
                "cjk_in_output": len(cjk_leak),
                "cjk_examples": [{"id": r["id"], "repeat": r["repeat"], "hyp": r["hypothesis"]} for r in cjk_leak[:5]],
            }

        report["directions"][direction] = {
            "n_per_repeat": {str(k): len(v) for k, v in sorted(by_repeat.items())},
            "chrf++": spread(chrfpp),
            "chrf": spread(chrf),
            "comet": spread(comet_means),
            "latency_ms": {
                "total_p50": pct(total, 0.5),
                "total_p95": pct(total, 0.95),
                "ttft_p50": pct(ttft, 0.5),
                "ttft_p95": pct(ttft, 0.95),
                "n": len(total),
            },
            "failures": len(rows[direction]) - len(ok),
            "tokens": tokens,
            "checks": checks,
        }

    # A partial rerun (e.g. only the zh source directions) has no vi<->en
    # baseline of its own; it is compared against a full run's scores by hand.
    if all(d in report["directions"] for d in BASELINE):
        baseline = statistics.fmean(report["directions"][d]["comet"]["mean"] for d in BASELINE)
        report["decision"] = {
            "rule": f"flag a zh direction whose COMET mean is more than {FLAG_MARGIN} below the vi<->en baseline mean",
            "baseline_comet_mean": baseline,
            "threshold": baseline - FLAG_MARGIN,
            "flags": {
                d: report["directions"][d]["comet"]["mean"] < baseline - FLAG_MARGIN
                for d in DIRECTIONS
                if d not in BASELINE
            },
        }
    else:
        report["decision"] = {"skipped": "no vi<->en baseline directions in this run"}
    report["tokens"] = usage_total
    report["cost_usd"] = {
        band: {
            "run_total": (usage_total["hit"] * p["hit"] + usage_total["miss"] * p["miss"] + usage_total["out"] * p["out"]) / 1e6,
            "per_1000_requests": (
                (usage_total["hit"] * p["hit"] + usage_total["miss"] * p["miss"] + usage_total["out"] * p["out"])
                / 1e6 / max(usage_total["requests"], 1) * 1000
            ),
        }
        for band, p in PRICE.items()
    }
    report["price_source"] = "api-docs.deepseek.com/quick_start/pricing, read 2026-10-13"

    out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({d: {k: round(v["comet"]["mean"], 4) for k, v in [("comet", report["directions"][d])]} for d in DIRECTIONS}))
    print(f"-> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
