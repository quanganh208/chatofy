"""Scribe's own language detection, per turn: the quality ceiling, not a runtime.

ElevenLabs Scribe v2 with NO language_code detects the language itself and
reports `language_code` + `language_probability`. That single top answer is
spread into a distribution (the rest split evenly) so it scores through the
same pipeline as every arm. It never ships -- `runtime: cloud` makes it
ineligible -- it says how far the local arms are from a strong cloud model.

Sends every turn's audio to ElevenLabs. Run it on prod/recorded turns only
under the consent the README records. The key is read from a file, never
from argv (argv is visible to every user on the machine via ps).

    uv run python arms/scribe_ceiling.py --manifest results/<tag>/manifest.jsonl \
        --out results/<tag> --token-file ~/.config/chatofy/elevenlabs.key
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
import uuid
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench.manifest import LANGUAGES, load  # noqa: E402

ARM = "scribe_ceiling"
ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text"
MODEL_ID = "scribe_v2"
#: Scribe answers ISO 639-3; anything outside these is "none of the three".
CODES = {"vie": "vi", "eng": "en", "cmn": "zh", "zho": "zh", "yue": "zh"}


def detect(key: str, wav: Path) -> tuple[str | None, float, float]:
    boundary = uuid.uuid4().hex
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"model_id\"\r\n\r\n{MODEL_ID}\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{wav.name}\"\r\n"
        "Content-Type: audio/wav\r\n\r\n"
    ).encode() + wav.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(ENDPOINT, data=body, method="POST", headers={
        "xi-api-key": key, "Content-Type": f"multipart/form-data; boundary={boundary}"})
    started = time.perf_counter()
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    return CODES.get(payload.get("language_code")), float(payload.get("language_probability") or 0.0), \
        (time.perf_counter() - started) * 1000


def spread(lang: str | None, prob: float) -> dict[str, float]:
    if lang is None:
        return {code: 1.0 / len(LANGUAGES) for code in LANGUAGES}
    rest = (1.0 - prob) / (len(LANGUAGES) - 1)
    return {code: (prob if code == lang else rest) for code in LANGUAGES}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--token-file", type=Path, required=True)
    args = parser.parse_args()
    key = args.token_file.expanduser().read_text().strip()
    rows = []
    for turn in load(args.manifest):
        lang, prob, ms = detect(key, BENCH_ROOT / turn.audio)
        rows.append({"id": turn.id, "prefix_ms": None, "speech_ms": turn.speech_ms,
                     "probs": {"en+vi+zh": spread(lang, prob)}, "latency_ms": round(ms, 1)})
    with (args.out / f"{ARM}.scores.jsonl").open("w", encoding="utf-8") as fh:
        fh.writelines(json.dumps(r) + "\n" for r in rows)
    (args.out / f"{ARM}.meta.json").write_text(json.dumps({
        "arm": ARM, "kind": "ceiling", "runtime": "cloud", "new_model": True,
        "notes": ["quality ceiling; latency includes the network; never eligible"]}, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
