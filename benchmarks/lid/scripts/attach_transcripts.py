"""Reference transcripts for the real tier, keyed by turn id.

    uv run --frozen python scripts/attach_transcripts.py

Ruler v5 leaves out turns that carry no language (`lid_bench.fillers`), which
it can only tell from what was said. The corpora ship their transcripts beside
the audio; this joins them to the bench's opaque ids the same way
`prepare_conversational.py` made those ids, and follows each re-recorded copy
back to the turn it was played from.

A turn with no usable transcript is written with `text: null`, never left out,
so the ruler can count how many it could not judge. VietMed's pause-cut
fragments (`vietmed-cut`) get null: the corpus transcript is the whole turn,
not the fragment that was kept.

RAMC's transcripts (`data/ramc/texts.jsonl`) are folded in when it is
prepared. Writes `data/transcripts.jsonl` (`data/` is ignored: transcripts are
corpus content, re-creatable from the pinned downloads).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))
sys.path.insert(0, str(BENCH_ROOT / "scripts"))

from lid_bench.manifest import load, opaque_id  # noqa: E402
from prepare_conversational import rows  # noqa: E402

DATA = BENCH_ROOT / "data"
OUT = DATA / "transcripts.jsonl"


def corpus_texts() -> dict[str, str]:
    """Raw key (as `prepare_conversational.py` builds it) -> transcript."""
    texts: dict[str, str] = {}
    # Same iteration as `edacc()`: the index over every pinned file is the key.
    for i, r in enumerate(rows("edacc", ["text"])):
        texts[f"edacc/{i}"] = r["text"]
    for r in rows("ascend", ["id", "transcription"], splits=("test", "validation")):
        texts[f"ascend/{r['_split']}/{r['id']}"] = r["transcription"]
    for r in rows("vietmed", ["utterance_id", "text"]):
        texts[f"vietmed/{r['utterance_id']}"] = r["text"]
    return texts


def main() -> int:
    by_key = corpus_texts()
    by_id = {opaque_id(key.split("/", 1)[0], key): text for key, text in by_key.items()}
    conversational = load(DATA / "conversational" / "manifest.jsonl")
    out: list[dict] = []
    for turn in conversational:
        text = None if turn.source == "vietmed-cut" else by_id.get(turn.id)
        out.append({"id": turn.id, "source": turn.source, "text": text})
    known = {row["id"]: row["text"] for row in out}
    rerecorded_path = DATA / "rerecorded" / "manifest.jsonl"
    if rerecorded_path.exists():
        played = {opaque_id("rerecorded", turn.id): turn.id for turn in conversational}
        for turn in load(rerecorded_path):
            if turn.noise:
                continue
            origin = played.get(turn.id)
            out.append({"id": turn.id, "source": turn.source, "text": known.get(origin) if origin else None})
    # RAMC (`prepare_ramc.py`) writes its own: its ids are made where its text is read.
    ramc = DATA / "ramc" / "texts.jsonl"
    if ramc.exists():
        out += [json.loads(line) for line in ramc.read_text().splitlines() if line.strip()]
    OUT.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in out))
    missing: dict[str, int] = {}
    for row in out:
        if row["text"] is None:
            missing[row["source"]] = missing.get(row["source"], 0) + 1
    print(f"wrote {len(out)} transcripts to {OUT.relative_to(BENCH_ROOT)}; without text: {missing or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
