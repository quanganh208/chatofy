"""Give every exported turn an independent transcript: what Scribe heard there.

    python3 -I benchmarks/translation-judge/scribe_turns.py --consent-recorded [--limit-calls N]

Reads `data/turns.jsonl`, `data/recordings.jsonl` and `data/audio/<conv>.webm`
(written by `export-conversations.mjs`). Sends each recording ONCE to
ElevenLabs Scribe v2 and caches the answer as `data/scribe/<conv>.json`; a
cached recording is never sent again. Then cuts Scribe's words into turns by
time and writes `data/turns.scribed.jsonl`, the judge's input.

Why a second transcript at all: the judge must tell a translation that is wrong
from one that faithfully renders a misheard source. Only an independent account
of what was said can separate them. Scribe is the reference that put prod's
Vietnamese STT at 8.6% WER.

The key is read from `ELEVENLABS_API_KEY` in the environment, else from that
line of `apps/api/.env`, and never from argv (argv is visible in `ps`).

`--consent-recorded` is required. It is the operator saying the README's
"Recordings and consent" section names whose voices these are and that sending
them to Scribe was approved.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(REPO / "benchmarks" / "stt"))

from stt_bench.scribe_reference import reference_words  # noqa: E402

DATA = HERE / "data"
ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text"
MODEL_ID = "scribe_v2"

#: A turn's stored offset is when its first block OPENED, which can trail the
#: first word by the recognizer's start-up. Words this far before the stamp
#: still belong to the turn; cutting at the stamp itself put a turn's first
#: word at the end of the previous one.
LEAD_MS = 300


def slice_words(words: list[tuple[float, float, str]], starts_ms: list[int | None]) -> tuple[list[str | None], int]:
    """Cut Scribe's (start s, end s, text) words into turns by their midpoints.

    `starts_ms` holds each turn's start inside the recording, in spoken order;
    None marks a turn with no time, which gets no words. Turn i owns the
    midpoints in [start_i - LEAD_MS, next start - LEAD_MS), the last turn owns
    everything after its start, so no word is given to two turns. Returns the
    texts (None where a turn owns no word) and how many words fell before the
    first turn and were dropped.
    """
    timed = sorted((ms - LEAD_MS, i) for i, ms in enumerate(starts_ms) if ms is not None)
    buckets: list[list[str]] = [[] for _ in starts_ms]
    dropped = 0
    for start_s, end_s, text in words:
        mid_ms = (start_s + end_s) * 500
        owner = None
        for bound, index in timed:
            if bound <= mid_ms:
                owner = index
            else:
                break
        if owner is None:
            dropped += 1
        else:
            buckets[owner].append(text)
    return [" ".join(b) if b else None for b in buckets], dropped


def api_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key:
        env = REPO / "apps" / "api" / ".env"
        if env.exists():
            for line in env.read_text().splitlines():
                if line.startswith("ELEVENLABS_API_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        raise SystemExit("ELEVENLABS_API_KEY is not set in the environment or apps/api/.env")
    return key


def transcribe(key: str, audio: Path) -> dict:
    boundary = uuid.uuid4().hex
    parts = []
    for name, value in (("model_id", MODEL_ID), ("tag_audio_events", "false")):
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{audio.name}"\r\n'
        f"Content-Type: audio/webm\r\n\r\n".encode()
        + audio.read_bytes()
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    request = urllib.request.Request(
        ENDPOINT,
        data=b"".join(parts),
        headers={"xi-api-key": key, "Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=600) as response:
        return json.load(response)


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--consent-recorded", action="store_true")
    parser.add_argument("--limit-calls", type=int, default=0, help="refuse when more Scribe calls are needed")
    args = parser.parse_args()

    turns = read_jsonl(DATA / "turns.jsonl")
    recordings = read_jsonl(DATA / "recordings.jsonl")
    cache = DATA / "scribe"
    cache.mkdir(exist_ok=True)
    needed = [rec for rec in recordings if not (cache / f"{rec['conv']}.json").exists()]
    print(f"{len(recordings)} recordings, {len(needed)} need a Scribe call", file=sys.stderr)
    if needed:
        if not args.consent_recorded:
            print("refusing: record consent in README.md first, then pass --consent-recorded", file=sys.stderr)
            return 2
        if len(needed) > args.limit_calls:
            print(f"refusing: {len(needed)} calls is above --limit-calls {args.limit_calls}", file=sys.stderr)
            return 2
        key = api_key()
        for rec in needed:
            answer = transcribe(key, DATA / "audio" / f"{rec['conv']}.webm")
            (cache / f"{rec['conv']}.json").write_text(json.dumps(answer, ensure_ascii=False))
            print(f"scribe {rec['conv'][:8]}: {answer.get('language_code')}", file=sys.stderr)

    out = []
    total_dropped = 0
    for rec in recordings:
        rows = sorted((t for t in turns if t["conv"] == rec["conv"]), key=lambda t: t["pos"])
        scribe = json.loads((cache / f"{rec['conv']}.json").read_text())
        texts, dropped = slice_words(reference_words(scribe), [t["mediaMs"] for t in rows])
        total_dropped += dropped
        for row, text in zip(rows, texts):
            out.append({**row, "scribe_source": text, "scribe_missing": text is None})
    (DATA / "turns.scribed.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in out))
    missing = sum(r["scribe_missing"] for r in out)
    print(
        f"{len(out)} turns, {missing} without Scribe words, {total_dropped} words before the first turn",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
