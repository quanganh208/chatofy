"""Is a synthesis call reproducible at the same seed regardless of WHERE it runs?

    uv run python scripts/check_call_position_determinism.py --engine zerotts-vi --voice baotrang

The main report leaves this open: the same seed produced 5.75% in the benchmark
run and 6.98% in the seed sweep, suspected ONNX Runtime state carried across
calls in a process. `score_clause_split.py` then showed the same thing from a
different angle — sentences with ONE clause take an identical code path in all
three of its arms, yet their control delta was not always zero.

That was inferred from transcripts. This checks the audio directly.

For each sentence the same text is synthesized at position 1, then again at
position 2 after an unrelated call has run in between, then a third time with
nothing in between. Byte-identical output at every position means call history
does not matter. Anything else means a recorded number is conditional on the
call sequence that produced it, and two runs of the same seed are not
comparable unless their sequences match.
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tts_vi_bench.engines.vieneu_vi import VieNeuVi  # noqa: E402
from tts_vi_bench.engines.zerotts_vi import ZeroTtsVi  # noqa: E402
from tts_vi_bench.measure import load_sentences  # noqa: E402

BENCH_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = BENCH_ROOT / "results" / "determinism"
ENGINES = {cls.engine_id: cls for cls in (VieNeuVi, ZeroTtsVi)}


def digest(samples: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(samples, dtype=np.float32).tobytes()).hexdigest()[:16]


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--engine", required=True, choices=sorted(ENGINES))
    p.add_argument("--voice", required=True)
    p.add_argument("--seed", type=int, default=20260914)
    p.add_argument("--limit", type=int, default=12)
    args = p.parse_args()

    sentences = load_sentences(BENCH_ROOT / "data" / "sentences-conversational.jsonl")[: args.limit]
    stochastic = args.engine == "zerotts-vi"
    engine = ENGINES[args.engine]()
    engine.load()

    def synth(text: str) -> np.ndarray:
        if stochastic:
            np.random.seed(args.seed)
            return np.asarray(engine._tts.synthesize(text, voice=args.voice),
                              dtype=np.float32).reshape(-1)
        return engine.synthesize(text, args.voice)[0]

    # A call that is not the one under test, run between positions 1 and 2 so
    # position 2 differs from position 3 only by what preceded it.
    filler = "Một hai ba bốn năm."

    rows, identical_adjacent, identical_after_filler = [], 0, 0
    for s in sentences:
        a = digest(synth(s.text))
        synth(filler)
        b = digest(synth(s.text))
        c = digest(synth(s.text))
        # c follows b with no unrelated call between; b follows a with one.
        identical_after_filler += a == b
        identical_adjacent += b == c
        rows.append({"id": s.id, "pos1": a, "after_filler": b, "adjacent": c,
                     "stable_across_filler": a == b, "stable_adjacent": b == c})
        print(f"{s.id}: {a} | {b} {'==' if a == b else '!='} pos1 | "
              f"{c} {'==' if b == c else '!='} prev", flush=True)

    n = len(rows)
    summary = {
        "engine": args.engine, "voice": args.voice, "seed": args.seed, "n": n,
        "identical_across_intervening_call": identical_after_filler,
        "identical_when_adjacent": identical_adjacent,
        "verdict": ("call position does not affect output"
                    if identical_after_filler == n
                    else "output depends on what ran before it in the process"),
        "rows": rows,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"call-position-{args.engine}-{args.voice.replace(' ', '-').lower()}.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nidentical across an intervening call: {identical_after_filler}/{n}")
    print(f"identical when adjacent:              {identical_adjacent}/{n}")
    print(f"verdict: {summary['verdict']}")
    print(f"[done] {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
