"""Fuse two recorded LID arms into one, optionally only on short turns.

    uv run --frozen python scripts/fuse_scores.py --run conv-r4-v5 --out probe-fusion-gated \\
        --name fusion_gated_1500 --gate-ms 1500 --exp 1,1
    uv run --frozen python scripts/fuse_scores.py --run conv-r4-v5 --out probe-fusion-gated \\
        --name fusion_gated_1500_set --gate-ms 1500 --exp 0.5,0.5 --exp-envi 0.7,0.3

A decision whose speech (`speech_ms` of that turn or prefix) is under
`--gate-ms` is p_first^a * p_second^b, renormalised, with `--exp a,b`
(1,1 = their plain product; 0.5,0.5 is the same ranking, less sure, which
moves where the tuned thresholds fall); anything longer keeps `first` alone,
at `first`'s latency. Fused decisions cost both latencies: the two run one
after the other. `--gate-ms 0` fuses every decision.

`--exp-envi` gives the vi/en pair (two-way en<->vi and 2-way detect) its
own exponents; the sets with zh keep `--exp`. The fused file then answers each
candidate set explicitly. Writes `<out>/<name>.{scores.jsonl,meta.json}` and
copies the run's manifest and facts, so the tag scores on its own.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench.run_data import FULL_KEY, mask, set_key  # noqa: E402

RESULTS = BENCH_ROOT / "results"
ENVI = ("en", "vi")
FLOOR = 1e-30


def mix(p: dict[str, float], q: dict[str, float], exp: tuple[float, float]) -> dict[str, float]:
    """p^a * q^b for exp (a, b), renormalised in log space."""
    logs = {k: exp[0] * math.log(max(p[k], FLOOR)) + exp[1] * math.log(max(q[k], FLOOR)) for k in p}
    top = max(logs.values())
    exp = {k: math.exp(v - top) for k, v in logs.items()}
    total = sum(exp.values())
    return {k: v / total for k, v in exp.items()}


def fuse_row(a: dict, b: dict | None, gate_ms: int, exp: tuple[float, float],
             exp_envi: tuple[float, float] | None) -> dict:
    """One decision: `a` alone when long or when `b` has no answer, else fused."""
    if b is None or (gate_ms and a["speech_ms"] >= gate_ms):
        return a
    p, q = a["probs"][FULL_KEY], b["probs"][FULL_KEY]
    fused = mix(p, q, exp)
    out = {**a, "latency_ms": round(a["latency_ms"] + b["latency_ms"], 2)}
    if exp_envi is None:
        out["probs"] = {FULL_KEY: fused}
    else:
        out["probs"] = {FULL_KEY: fused, set_key(ENVI): mask(mix(p, q, exp_envi), ENVI)}
    return out


def exponents(text: str) -> tuple[float, float]:
    a, b = (float(x) for x in text.split(","))
    return a, b


def read(path: Path) -> dict[tuple, dict]:
    rows = {}
    for line in path.read_text().splitlines():
        row = json.loads(line)
        rows[(row["id"], row["prefix_ms"])] = row
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--first", default="whisper_probs_base_ctx5")
    parser.add_argument("--second", default="ambernet")
    parser.add_argument("--gate-ms", type=int, default=1500)
    parser.add_argument("--exp", type=exponents, default=(1.0, 1.0))
    parser.add_argument("--exp-envi", type=exponents)
    parser.add_argument("--note", action="append", default=[])
    args = parser.parse_args()

    src, out = RESULTS / args.run, RESULTS / args.out
    if (out / f"{args.name}.scores.jsonl").exists():
        raise SystemExit(f"{out.name}/{args.name} exists: pick a new name, recorded results are not overwritten")
    first, second = read(src / f"{args.first}.scores.jsonl"), read(src / f"{args.second}.scores.jsonl")
    out.mkdir(parents=True, exist_ok=True)
    for name in ("manifest.jsonl", "facts.jsonl"):
        if not (out / name).exists():
            shutil.copy(src / name, out / name)
        elif (out / name).read_bytes() != (src / name).read_bytes():
            raise SystemExit(f"{out.name}/{name} differs from {src.name}'s: one tag, one set of turns")
    rows = [fuse_row(a, second.get(key), args.gate_ms, args.exp, args.exp_envi) for key, a in first.items()]
    (out / f"{args.name}.scores.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    meta = json.loads((src / f"{args.second}.meta.json").read_text())
    gate = f"speech under {args.gate_ms} ms" if args.gate_ms else "every decision"
    shares = f"exponents {args.exp}" + (f", {args.exp_envi} on en+vi" if args.exp_envi else "")
    meta.update(arm=args.name, notes=[f"fusion of {args.first} and {args.second} on {gate}; {shares}",
                                      "fused latency is the sum of both (sequential)",
                                      *[n for n in meta.get("notes", []) if "licence" in n], *args.note])
    (out / f"{args.name}.meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    fused = sum(1 for a, r in zip(first.values(), rows) if r is not a)
    print(f"wrote {out.name}/{args.name}: {fused} of {len(rows)} decisions fused")
    return 0


if __name__ == "__main__":
    sys.exit(main())
