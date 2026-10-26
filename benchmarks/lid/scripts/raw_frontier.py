"""Can a second (and third) LID voter pass the 3-way detect bars? Raw, per turn.

    uv run --frozen python scripts/raw_frontier.py [--groups speaker] > frontier.md

The gate (`score.py`) answers this through sessions, priors and locks; that
costs an hour per arm. This answers the narrower question first, on whole
short real turns under ruler v5 (the 1431 `<1.5` turns `conv-r4-v5` scores):
3-way detect is the argmax of

    sum_v w_v * log p_v(lang)  +  b * [lang == zh]  +  k * [SenseVoice says lang]

against the bars the user set (2026-10-24, baseline fixed 2026-10-25):
short en and short vi at most 2 points under the 2-way detect prod runs
today (`whisper_probs_base_ctx5` choosing between vi and en), and short zh
at least 0.85.

Parameters are chosen leave-one-source-out (`--groups source`, the default)
or leave-one-speaker-out (`--groups speaker`): for each held-out group the
grid point is picked on the rest -- the best
zh among points that keep en and vi inside the budget there, else the point
closest to it -- and applied to the held-out source. The pooled held-out
accuracies are the numbers that count; the in-sample best is printed beside
them only to show how much the choice was worth. RAMC (measure-only, also
under ruler v5) is never tuned on: it gets the parameters chosen on all of
`conv-r4-v5`.

SenseVoice knows no Vietnamese, so its tag can only move en against zh (`k`).
"""

from __future__ import annotations

import argparse
import itertools
import json
import sys
from pathlib import Path

import numpy as np

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

import score  # noqa: E402
from lid_bench.manifest import load  # noqa: E402
from lid_bench.run_data import FULL_KEY, load_facts  # noqa: E402

RESULTS = BENCH_ROOT / "results"
L = ("en", "vi", "zh")
BUDGET = 0.02
ZH_BAR = 0.85
FLOOR = 1e-12
BIASES = [x / 4 for x in range(-24, 13)]
WEIGHTS = (0.0, 0.25, 0.5, 0.75, 1.0, 1.5)
SV_BONUS = (0.0, 1.0, 2.0, 4.0, 8.0)


def read_scores(path: Path) -> dict[str, dict[str, float]]:
    out = {}
    if path.exists():
        for line in path.read_text().splitlines():
            row = json.loads(line)
            if row.get("prefix_ms") is None:
                out[row["id"]] = row["probs"][FULL_KEY]
    return out


def read_tags(path: Path) -> dict[str, str]:
    return {r["id"]: r["lang"] for r in map(json.loads, path.read_text().splitlines())} if path.exists() else {}


def ramc_ctx5() -> dict[str, dict[str, float]]:
    """Whisper-base ctx5's three language log-probs, as the sidecar computes
    them, from the encoder-feature dump (last three columns, vi/en/zh)."""
    dump = np.load(BENCH_ROOT / "data" / "features" / "ramc.npz", allow_pickle=True)
    order = [str(x) for x in dump["languages"]]
    out = {}
    for tid, prefix, row in zip(dump["ids"], dump["prefix_ms"], dump["X"]):
        if prefix == -1:
            logp = row[-3:]
            p = np.exp(logp - logp.max())
            out[str(tid)] = dict(zip(order, (p / p.sum()).tolist()))
    return out


def group_of(turn, scheme: str) -> str:
    """Hold out a whole source, or one speaker: short vi is one source
    (vietmed-cut, 10 speakers), so leaving the source out tunes vi blind."""
    return turn.source if scheme == "source" or not turn.speaker else f"{turn.source}:{turn.speaker}"


def logs(src: dict[str, dict[str, float]], ids: list[str]) -> np.ndarray:
    return np.log(np.maximum(np.array([[src[i][lang] for lang in L] for i in ids]), FLOOR))


def onehot(tags: dict[str, str], ids: list[str]) -> np.ndarray:
    """SenseVoice's tag as a vote for en or zh; it has no vi, and "other" votes nothing."""
    return np.array([[float(tags.get(i) == lang and lang != "vi") for lang in L] for i in ids])


def predict(first: np.ndarray, second: np.ndarray | None, sv: np.ndarray | None, point) -> np.ndarray:
    w, b, k = point
    s = first + (w * second if second is not None else 0) + (k * sv if sv is not None else 0)
    s = s + np.array([0.0, 0.0, b])
    return s.argmax(axis=1)


def accuracy(truth: np.ndarray, guess: np.ndarray) -> dict[str, float | None]:
    return {lang: (float((guess[truth == j] == j).mean()) if (truth == j).any() else None) for j, lang in enumerate(L)}


def margin(acc, prod2) -> float:
    """How far inside (>0) or outside (<0) both vi/en budgets a point is."""
    gaps = [acc[lang] - (prod2[lang] - BUDGET) for lang in ("en", "vi")
            if acc[lang] is not None and prod2[lang] is not None]
    return min(gaps) if gaps else 0.0


def pick(rows: np.ndarray, truth, prod2_guess, grid, feats) -> tuple:
    """Best zh among grid points inside both budgets on `rows`, else the point closest to them."""
    prod2 = accuracy(truth[rows], prod2_guess[rows])
    best, best_key = None, None
    sub = [f[rows] if f is not None else None for f in feats]
    for point in grid:
        acc = accuracy(truth[rows], predict(*sub, point))
        m = margin(acc, prod2)
        key = (1, acc["zh"] or 0.0) if m >= 0 else (0, m)
        if best_key is None or key > best_key:
            best, best_key = point, key
    return best


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sensevoice", type=Path, default=RESULTS / "probe-sensevoice" / "conv",
                        help="dir holding sensevoice_lid.jsonl for the conv turns")
    parser.add_argument("--sensevoice-ramc", type=Path, default=RESULTS / "probe-sensevoice" / "ramc")
    parser.add_argument("--groups", choices=("source", "speaker"), default="source",
                        help="what is held out while choosing parameters (default: the whole source)")
    args = parser.parse_args()

    run = RESULTS / "conv-r4-v5"
    turns, facts = load(run / "manifest.jsonl"), load_facts(run)
    excluded = score.no_language_turns(turns, facts)
    short = [t for t in turns if t.real and not t.noise and t.bucket == "<1.5" and t.id not in excluded
             and t.source != "l2arctic"]
    src = {"ctx5": read_scores(run / "whisper_probs_base_ctx5.scores.jsonl"),
           "amber": read_scores(run / "ambernet.scores.jsonl"),
           "medium": read_scores(RESULTS / "probe-medium" / "whisper_probs_medium.scores.jsonl"),
           "ecapa": read_scores(RESULTS / "probe-ecapa" / "ecapa_vl107.scores.jsonl")}
    tags = read_tags(args.sensevoice / "sensevoice_lid.jsonl") if args.sensevoice else {}
    ramc_short = set((RESULTS / "probe-ramc" / "short-ids.txt").read_text().split())
    ramc_turns = [t for t in load(RESULTS / "probe-ramc" / "manifest.jsonl") if t.id in ramc_short]
    # Ruler v5 for RAMC too. Its tag has no turn_facts: the floor reads the
    # sidecar's own speech measure the manifest was bucketed with.
    ramc_excluded = score.no_language_turns(ramc_turns, {t.id: {"silero_ms": t.speech_ms} for t in ramc_turns})
    ramc_turns = [t for t in ramc_turns if t.id not in ramc_excluded]
    ramc = {"ctx5": ramc_ctx5(), "medium": read_scores(RESULTS / "probe-ramc" / "whisper_probs_medium.scores.jsonl"),
            "ecapa": src["ecapa"]}
    ramc_tags = read_tags(args.sensevoice_ramc / "sensevoice_lid.jsonl") if args.sensevoice_ramc else {}

    order = {lang: j for j, lang in enumerate(L)}
    combos = {
        "ctx5": ("ctx5", None, False),
        "ctx5 + SenseVoice": ("ctx5", None, True),
        "ctx5 x ECAPA": ("ctx5", "ecapa", False),
        "ctx5 x ECAPA + SenseVoice": ("ctx5", "ecapa", True),
        "ctx5 x AmberNet (ceiling: cannot ship)": ("ctx5", "amber", False),
        "ctx5 x AmberNet + SenseVoice (ceiling)": ("ctx5", "amber", True),
        "medium (GPU)": ("medium", None, False),
        "medium + SenseVoice (GPU)": ("medium", None, True),
        "medium x ECAPA + SenseVoice (GPU)": ("medium", "ecapa", True),
        "medium x AmberNet (GPU, ceiling)": ("medium", "amber", False),
    }
    all_ids = [t.id for t in short]
    prod2_all = np.where(logs(src["ctx5"], all_ids)[:, 0] >= logs(src["ctx5"], all_ids)[:, 1], 0, 1)
    print(f"Held out by {args.groups}. prod 2-way: " + ", ".join(
        f"{k} {v:.3f}" for k, v in accuracy(np.array([order[t.lang] for t in short]), prod2_all).items() if v))
    print()
    print("| combination | n | en | vi | zh | RAMC zh | params (all conv) | in-sample best en / vi / zh |")
    print("|---|---|---|---|---|---|---|---|")
    for name, (first, second, use_sv) in combos.items():
        needed = [first] + ([second] if second else [])
        pool = [t for t in short if all(t.id in src[s] for s in needed) and (not use_sv or t.id in tags)]
        if len(pool) < 0.95 * len(short):
            print(f"| {name} | {len(pool)} | — | — | — | — | missing scores | |")
            continue
        ids = [t.id for t in pool]
        truth = np.array([order[t.lang] for t in pool])
        feats = [logs(src[first], ids), logs(src[second], ids) if second else None,
                 onehot(tags, ids) if use_sv else None]
        prod2_guess = np.where(logs(src["ctx5"], ids)[:, 0] >= logs(src["ctx5"], ids)[:, 1], 0, 1)
        grid = list(itertools.product(WEIGHTS if second else (0.0,), BIASES, SV_BONUS if use_sv else (0.0,)))
        groups = np.array([group_of(t, args.groups) for t in pool])
        held = np.empty(len(pool), dtype=int)
        for g in np.unique(groups):
            test = groups == g
            point = pick(~test, truth, prod2_guess, grid, feats)
            held[test] = predict(*[f[test] if f is not None else None for f in feats], point)
        acc, base = accuracy(truth, held), accuracy(truth, prod2_guess)
        everything = pick(np.ones(len(pool), bool), truth, prod2_guess, grid, feats)
        insample = accuracy(truth, predict(*feats, everything))
        ramc_cell = "—"
        if all(s in ramc for s in needed):
            rp = [t for t in ramc_turns if all(t.id in ramc[s] for s in needed) and (not use_sv or t.id in ramc_tags)]
            rids = [t.id for t in rp]
            rf = [logs(ramc[first], rids), logs(ramc[second], rids) if second else None,
                  onehot(ramc_tags, rids) if use_sv else None]
            rz = accuracy(np.array([order[t.lang] for t in rp]), predict(*rf, everything))["zh"]
            ramc_cell = f"{rz:.3f} (n={len(rp)})"

        def cell(lang, acc=acc, base=base):
            if lang == "zh":
                return f"{acc[lang]:.3f} {'✓' if acc[lang] >= ZH_BAR else '✗'}"
            ok = acc[lang] >= base[lang] - BUDGET
            return f"{acc[lang]:.3f} ({acc[lang] - base[lang]:+.3f}) {'✓' if ok else '✗'}"

        print(f"| {name} | {len(pool)} | {cell('en')} | {cell('vi')} | {cell('zh')} | {ramc_cell} | "
              f"w={everything[0]} b={everything[1]} k={everything[2]} | "
              f"{insample['en']:.3f} / {insample['vi']:.3f} / {insample['zh']:.3f} |", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
