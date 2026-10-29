"""Paired bootstrap of segment-level COMET between mt-zh runs.

`score.py` keeps only per-direction means, which cannot say whether two runs
differ by more than sampling noise. This scores every run on the SAME
(direction, id) keys — those every run answered without error — and resamples
the per-segment deltas against the first run named.

    cd benchmarks/live-translate && uv run --frozen --with "setuptools<81" \
        python -I ../mt-zh/paired-bootstrap.py ../mt-zh/results/<baseline> ../mt-zh/results/<run> ...
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path


def load(run: Path) -> dict[tuple[str, int], dict]:
    rows = {}
    for path in run.glob("*_to_*.jsonl"):
        for line in path.read_text(encoding="utf-8").splitlines():
            row = json.loads(line)
            if row.get("repeat", 1) == 1:
                rows[(row["direction"], row["id"])] = row
    return rows


def main() -> None:
    runs = [Path(p) for p in sys.argv[1:]]
    if len(runs) < 2:
        sys.exit("usage: paired-bootstrap.py <baseline-run> <run> [<run> ...]")
    data = {run.name: load(run) for run in runs}
    keys = sorted(
        set.intersection(*[{k for k, r in rows.items() if not r["error"]} for rows in data.values()])
    )
    print(f"segments scored per run: {len(keys)}")

    from comet import download_model, load_from_checkpoint

    model = load_from_checkpoint(download_model("Unbabel/wmt22-comet-da"))
    names = list(data)
    samples = [
        {"src": data[n][k]["source"], "mt": data[n][k]["hypothesis"] or "", "ref": data[n][k]["reference"]}
        for n in names
        for k in keys
    ]
    scores = model.predict(samples, batch_size=32, gpus=0, progress_bar=False).scores
    per = {n: scores[i * len(keys) : (i + 1) * len(keys)] for i, n in enumerate(names)}

    base = per[names[0]]
    random.seed(0)
    print(f"{'run':44} mean    delta   95% CI              p(delta<=0)")
    for n in names:
        deltas = [a - b for a, b in zip(per[n], base)]
        boots = sorted(sum(random.choice(deltas) for _ in deltas) / len(deltas) for _ in range(2000))
        p = sum(1 for b in boots if b <= 0) / len(boots)
        print(
            f"{n:44} {sum(per[n]) / len(keys):.4f} {sum(deltas) / len(keys):+.4f} "
            f"[{boots[50]:+.4f},{boots[1949]:+.4f}]  {p:.3f}"
        )


if __name__ == "__main__":
    main()
