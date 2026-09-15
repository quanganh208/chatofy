"""Compare the two engines as DISTRIBUTIONS, not as points.

The main benchmark scores each arm once per run tag, which is enough for latency
and not enough for WER: both engines turn out to move by 13-29 percentage points
from one run to the next. A single run's WER is therefore a draw, and comparing
two draws says almost nothing.

`scripts/seed_sensitivity.py` collects the draws. This reads them and asks the
three questions that survive that much spread:

1. **Does the central tendency differ?** Median, not mean — one catastrophic run
   (ZeroTTS seed 66 at 36%) drags a mean around far more than it should.
2. **How often does a random run of A beat a random run of B?** That is the
   Mann-Whitney U statistic normalised to [0,1] — a "common-language effect
   size", and the figure that actually answers "if I ship this, will a given
   utterance be better?"
3. **Does the difference survive resampling?** A bootstrap CI on the difference
   of medians. With n=8 against n=6 the interval is wide by construction, and
   an interval spanning zero has to be reported as a tie.

    uv run python analyze_variability.py
"""

import itertools
import json
import statistics as st
from pathlib import Path

import numpy as np

RESULTS = Path(__file__).resolve().parent / "results" / "seed-sensitivity"

PAIRS = [
    ("female", "summary-baotrang.json", "summary-mai-anh.json"),
    ("male", "summary-quangminh.json", "summary-thanh-binh.json"),
]


def load(name: str) -> tuple[str, list[float]]:
    """Read one engine/voice's set of runs.

    `engine` is defaulted because the first summary written predates the
    script's generalisation to both engines — the runs themselves are the same
    measurement either way, so the file is read rather than discarded.
    """
    d = json.loads((RESULTS / name).read_text(encoding="utf-8"))
    label = f"{d.get('engine', 'zerotts-vi')}/{d['voice']}"
    return label, sorted(r["wer"] * 100 for r in d["runs"])


def common_language_effect(a: list[float], b: list[float]) -> float:
    """P(a random draw from A beats one from B), ties counted as half.

    Lower WER wins, so "beats" means strictly smaller.
    """
    wins = sum((1.0 if x < y else 0.5 if x == y else 0.0)
               for x, y in itertools.product(a, b))
    return wins / (len(a) * len(b))


def bootstrap_median_diff(a: list[float], b: list[float],
                          n: int = 20000, seed: int = 20260914) -> dict:
    rng = np.random.default_rng(seed)
    a_arr, b_arr = np.asarray(a), np.asarray(b)
    diffs = np.empty(n)
    for i in range(n):
        diffs[i] = (np.median(rng.choice(a_arr, a_arr.size, replace=True))
                    - np.median(rng.choice(b_arr, b_arr.size, replace=True)))
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    return {"observed": st.median(a) - st.median(b),
            "ci95": (float(lo), float(hi)),
            "separates": bool(lo > 0 or hi < 0)}


def main() -> int:
    out = {}
    print(f"{'engine/voice':<24}{'n':>3}{'median':>9}{'mean':>8}{'min':>8}{'max':>8}{'spread':>9}")
    for gender, fa, fb in PAIRS:
        for f in (fa, fb):
            label, w = load(f)
            print(f"{label:<24}{len(w):>3}{st.median(w):9.2f}{st.mean(w):8.2f}"
                  f"{min(w):8.2f}{max(w):8.2f}{max(w)-min(w):9.2f}")
    print()

    for gender, fa, fb in PAIRS:
        la, a = load(fa)
        lb, b = load(fb)
        cle = common_language_effect(a, b)
        boot = bootstrap_median_diff(a, b)
        lo, hi = boot["ci95"]
        print(f"--- {gender}: {la} vs {lb} ---")
        print(f"  median difference : {boot['observed']:+.2f}pp  "
              f"95% CI [{lo:+.2f}, {hi:+.2f}]  separates={boot['separates']}")
        print(f"  P(zerotts run beats vieneu run): {cle*100:.1f}%")
        print(f"  overlap: zerotts worst {max(a):.2f} vs vieneu best {min(b):.2f} "
              f"-> {'distributions OVERLAP' if max(a) > min(b) else 'disjoint'}")
        out[gender] = {"a": la, "b": lb, "a_runs": a, "b_runs": b,
                       "median_diff_pp": boot["observed"], "ci95_pp": boot["ci95"],
                       "separates": boot["separates"],
                       "p_a_beats_b": cle,
                       "overlap": max(a) > min(b)}
        print()

    (RESULTS / "variability-analysis.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[done] {RESULTS / 'variability-analysis.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
