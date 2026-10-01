"""What an arm is: a module with `load(variant, threads) -> restore`.

`restore(text) -> str` — or `restore(text, pauses)` for an arm that reads
pauses, given the row's per-word silences in ms (None on a text-only ruler) — gets `model_input` text (lowercase words, single spaces,
no marks) and returns the same words cased and punctuated. Everything else —
reading rows, timing each call, writing predictions — lives here, so no arm can
measure itself differently from another.

An arm module ends with:

    if __name__ == "__main__":
        main(load)

and is run by `punct_bench.run` as its own process, so peak RSS is the arm's.
"""
import argparse
import inspect
import json
import sys
import time
from collections.abc import Callable
from pathlib import Path

Restore = Callable[[str], str]
Load = Callable[[str, int], Restore]

# Untimed calls before measuring: the first ONNX/torch call allocates arenas
# and would otherwise count as the slowest row of whichever ruler runs first.
WARMUP = ("xin chào các bạn hôm nay chúng ta nói về trí tuệ nhân tạo",) * 3


def main(load: Load) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--variant", required=True)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=0, help="rows per ruler; 0 = all")
    parser.add_argument("rows", type=Path, nargs="+")
    args = parser.parse_args()

    started = time.perf_counter()
    restore = load(args.variant, args.threads)
    load_s = time.perf_counter() - started
    reads_pauses = len(inspect.signature(restore).parameters) >= 2
    for text in WARMUP:
        restore(text, None) if reads_pauses else restore(text)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with args.out.open("w", encoding="utf-8") as out:
        for path in args.rows:
            rows = [json.loads(line) for line in path.open(encoding="utf-8")]
            if args.limit:
                rows = rows[: args.limit]
            for row in rows:
                t0 = time.perf_counter()
                try:
                    if reads_pauses:
                        pred = restore(row["input"], row.get("pauses"))
                    else:
                        pred = restore(row["input"])
                    error = None
                except Exception as err:  # recorded per row, never hidden
                    pred, error = "", f"{type(err).__name__}: {err}"
                ms = (time.perf_counter() - t0) * 1000
                record = {"ruler": row["ruler"], "id": row["id"], "pred": pred, "ms": round(ms, 2)}
                if error:
                    record["error"] = error
                out.write(json.dumps(record, ensure_ascii=False) + "\n")
                count += 1
    # The runner reads this last line; anything printed before it is log.
    print(json.dumps({"load_s": round(load_s, 2), "rows": count}), file=sys.stdout, flush=True)
