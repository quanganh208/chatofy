"""A second witness: does the judge's severity move with CometKiwi's score?

    cd benchmarks/live-translate && uv run --frozen --with "setuptools<81" python -I \
        ../translation-judge/cometkiwi.py --run ../translation-judge/results/<run> \
        --turns ../translation-judge/data/turns.scribed.jsonl

CometKiwi (`Unbabel/wmt22-cometkiwi-da`) scores a translation against its
source with no reference. It is CC-BY-NC, which a non-commercial thesis may
use. It is gated on Hugging Face: accept its licence and log in
(`huggingface-cli login`) before the first run. It runs on CPU and makes no
paid call.

The source given to Kiwi is Scribe's hearing where there is one, because the
judge also grades against what was said. Severity points per turn are the mean
over repeats of minor 1, major 5, critical 10, the MQM weights. A judge that
tracks quality should show a clearly negative Spearman correlation: more
severity, lower Kiwi. This is reported beside the error table, not a gate.

Borrows the `live-translate` environment, as `benchmarks/mt-zh/score.py` does,
because it pins unbabel-comet.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

MODEL = "Unbabel/wmt22-cometkiwi-da"
POINTS = {"minor": 1, "major": 5, "critical": 10}


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def severity_points(answers: list[dict]) -> float:
    return sum(sum(POINTS[e["severity"]] for e in a["errors"]) for a in answers) / len(answers)


def ranks(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    out = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            out[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return out


def spearman(x: list[float], y: list[float]) -> float:
    rx, ry = ranks(x), ranks(y)
    mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    sx = sum((a - mx) ** 2 for a in rx) ** 0.5
    sy = sum((b - my) ** 2 for b in ry) ** 0.5
    return cov / (sx * sy) if sx and sy else float("nan")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--turns", type=Path, required=True)
    args = parser.parse_args()

    answers: dict[str, list[dict]] = {}
    for line in read_jsonl(args.run / "judgements.jsonl"):
        if not line.get("failed"):
            answers.setdefault(line["id"], []).append(line)
    rows = [
        r for r in read_jsonl(args.turns) if r.get("translation") and len(answers.get(f"{r['conv']}#{r['pos']}", [])) >= 2
    ]

    from comet import download_model, load_from_checkpoint

    model = load_from_checkpoint(download_model(MODEL))
    data = [{"src": r["scribe_source"] or r["source"], "mt": r["translation"]} for r in rows]
    kiwi = model.predict(data, batch_size=8, gpus=0, progress_bar=False).scores
    points = [severity_points(answers[f"{r['conv']}#{r['pos']}"]) for r in rows]
    rho = spearman(points, kiwi)
    print(f"CometKiwi vs judge severity: Spearman {rho:.3f} over {len(rows)} turns")
    print(f"mean Kiwi {sum(kiwi) / len(kiwi):.3f}; turns with severity 0: mean Kiwi "
          f"{sum(k for k, p in zip(kiwi, points) if p == 0) / max(1, sum(p == 0 for p in points)):.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
