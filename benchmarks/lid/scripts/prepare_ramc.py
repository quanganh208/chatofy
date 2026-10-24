"""MagicData-RAMC test split -> a second, Mainland Mandarin real-speech source.

    uv run --frozen python scripts/prepare_ramc.py

ASCEND is the bench's only conversational Mandarin, and its speakers are
bilingual students in Hong Kong. RAMC (OpenSLR 123) is 180 h of two-person
Mandarin conversation recorded on phones by 663 Mainland speakers. Its licence
is CC BY-NC-ND 4.0: it may be MEASURED on, never trained on, so its group
`ramc` is passed to every trained arm as `--eval-only ramc`.

Only the release's own test split (43 conversations) is used. The archive is
fetched by hand into `data/downloads/magicdata-ramc/` from
https://openslr.elda.org/resources/123/MagicData-RAMC.tar.gz (15,470,673,657
bytes, sha256 65d2ff24cc3cd1312d70a008387abea81fd24aa82ac52b18cd1f8630107dc3e5),
and `DataPartition/`, `MDT2021S003/{SPKINFO,UTTERANCEINFO}.txt`, `TXT/` and the
test split's WAVs are extracted under `x/`. Each conversation becomes
sessions of RAMC_SESSION_TURNS consecutive segments in recorded order, both
speakers kept; segments with no speaker ("无") are dropped.

Writes `data/ramc/manifest.jsonl` and `data/ramc/texts.jsonl` (id -> the
corpus transcript, which `scripts/attach_transcripts.py` folds into the
ruler's transcripts).
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench.audio import decode, write_wav  # noqa: E402
from lid_bench.clips import prepare_clip  # noqa: E402
from lid_bench.manifest import Turn, bucket_for, opaque_id, save  # noqa: E402
from lid_bench.sidecar import speech_ms  # noqa: E402

ROOT = BENCH_ROOT / "data" / "downloads" / "magicdata-ramc" / "x"
OUT = BENCH_ROOT / "data" / "ramc"
RATE = 16000
LICENSE = "CC-BY-NC-ND-4.0"
#: Segments per session, and sessions per conversation: two sessions of 40
#: from each of 43 conversations keep one scoring run near ASCEND's size.
RAMC_SESSION_TURNS = 40
SESSIONS_PER_CONVERSATION = 2
SEGMENT = re.compile(r"^\[(\d+\.\d+),(\d+\.\d+)\]\t(\S+)\t([^\t]*)\t(.*)$")


def test_conversations() -> list[str]:
    lines = (ROOT / "DataPartition" / "test.tsv").read_text().splitlines()[1:]
    return [line.split("\t")[0].removesuffix(".wav") for line in lines if line.strip()]


def devices() -> dict[str, str]:
    """Speaker id -> recording device, from SPKINFO."""
    out = {}
    for line in (ROOT / "MDT2021S003" / "SPKINFO.txt").read_text().splitlines()[1:]:
        cols = line.split("\t")
        if len(cols) >= 6:
            out[cols[1]] = cols[5].strip().lower().replace(" ", "-")
    return out


def segments(conversation: str) -> list[tuple[float, float, str, str]]:
    out = []
    for line in (ROOT / "MDT2021S003" / "TXT" / f"{conversation}.txt").read_text(encoding="utf-8").splitlines():
        m = SEGMENT.match(line)
        if m and m.group(3) != "无" and not m.group(4).startswith("无"):
            out.append((float(m.group(1)), float(m.group(2)), m.group(3), m.group(5)))
    return sorted(out)


def main() -> int:
    channel = devices()
    turns: list[Turn] = []
    texts: list[dict] = []
    for conversation in test_conversations():
        wav = ROOT / "MDT2021S003" / "WAV" / f"{conversation}.wav"
        if not wav.exists():
            raise SystemExit(f"{wav} missing: extract the test split first (see the docstring)")
        audio = decode(wav)
        segs = segments(conversation)[: RAMC_SESSION_TURNS * SESSIONS_PER_CONVERSATION]
        for i, (start, end, speaker, text) in enumerate(segs):
            samples = prepare_clip(audio[int(start * RATE): int(end * RATE)])
            key = f"ramc/{conversation}/{start:.3f}"
            turn_id = opaque_id("ramc", key)
            path = OUT / f"{turn_id}.wav"
            write_wav(path, samples)
            measured = speech_ms(samples)
            session = opaque_id("session", f"ramc:{conversation}:{i // RAMC_SESSION_TURNS}")
            turns.append(Turn(id=turn_id, audio=path.relative_to(BENCH_ROOT).as_posix(), lang="zh",
                              bucket=bucket_for(measured), speech_ms=measured,
                              channel=channel.get(speaker, "phone"), group="ramc", source="ramc", real=True,
                              license=LICENSE, session=session, order=i % RAMC_SESSION_TURNS,
                              speaker=f"ramc:{speaker}"))
            texts.append({"id": turn_id, "source": "ramc", "text": text})
    save(OUT / "manifest.jsonl", turns)
    (OUT / "texts.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in texts))
    buckets = defaultdict(int)
    for t in turns:
        buckets[t.bucket] += 1
    print(f"wrote {len(turns)} RAMC turns from {len(test_conversations())} conversations: {dict(sorted(buckets.items()))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
