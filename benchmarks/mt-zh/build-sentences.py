"""Build the fixed MT sentence set: 200 FLoRes sentences present in zh, vi and en.

FLEURS reads FLoRes sentences aloud, so its `id` column is the FLoRes sentence
id and the three language configs can be joined on it. Only the text columns are
read: duckdb fetches them by HTTP range request, so the ~1.8 GB of audio in the
same parquet files is never downloaded.

    uv run --no-project --with duckdb python -I build-sentences.py

Writes `data/sentences.jsonl` and refuses to overwrite it: the set is fixed
before any number exists, and a re-draw after seeing results would be choosing
the test.
"""

from __future__ import annotations

import json
import random
import sys
from collections import Counter
from pathlib import Path

import duckdb

HERE = Path(__file__).resolve().parent
OUT = HERE / "data" / "sentences.jsonl"
CONFIGS = {"zh": "cmn_hans_cn", "vi": "vi_vn", "en": "en_us"}
SPLIT = "test"
COUNT = 200
SEED = 42
URL = "https://huggingface.co/api/datasets/google/fleurs/parquet/{config}/{split}/0.parquet"


def read_config(con: duckdb.DuckDBPyConnection, config: str) -> dict[int, str]:
    """One text per FLoRes id.

    FLEURS has several recordings (speakers) per sentence, so an id repeats.
    The text should be identical across them; when it is not, the most common
    spelling wins and ties break lexicographically, so the pick is
    deterministic rather than whichever row the file happened to list first.
    """
    rows = con.sql(
        f"select id, raw_transcription from read_parquet('{URL.format(config=config, split=SPLIT)}')"
    ).fetchall()
    by_id: dict[int, Counter[str]] = {}
    for sentence_id, text in rows:
        text = (text or "").strip()
        if text:
            by_id.setdefault(int(sentence_id), Counter())[text] += 1
    return {
        sentence_id: sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        for sentence_id, counts in by_id.items()
    }


def main() -> int:
    if OUT.exists():
        print(f"{OUT} already exists; the set is fixed. Delete it by hand to re-draw.", file=sys.stderr)
        return 1
    con = duckdb.connect()
    texts = {lang: read_config(con, config) for lang, config in CONFIGS.items()}
    common = sorted(set.intersection(*(set(t) for t in texts.values())))
    for lang, t in texts.items():
        print(f"{lang}: {len(t)} distinct ids", file=sys.stderr)
    print(f"present in all three: {len(common)}", file=sys.stderr)
    if len(common) < COUNT:
        print(f"need {COUNT}, have {len(common)}", file=sys.stderr)
        return 1

    picked = sorted(random.Random(SEED).sample(common, COUNT))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as f:
        for sentence_id in picked:
            row = {"id": sentence_id, **{lang: texts[lang][sentence_id] for lang in CONFIGS}}
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    meta = {
        "source": "google/fleurs parquet (refs/convert/parquet), column raw_transcription",
        "license": "CC-BY-4.0",
        "configs": CONFIGS,
        "split": SPLIT,
        "seed": SEED,
        "count": COUNT,
        "pool": len(common),
        "draw": "random.Random(seed).sample(sorted(common ids), count), then sorted",
    }
    (OUT.parent / "sentences.meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"wrote {COUNT} rows to {OUT}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
