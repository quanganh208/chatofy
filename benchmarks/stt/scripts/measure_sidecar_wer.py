"""WER of the local-stt sidecar as the app actually calls it.

Why this exists next to `run_benchmark.py` rather than inside it: that harness
loads engines in-process to compare model stacks, and the thing most recently
found wrong was not a model but a WIRE — the sidecar defaulting Vietnamese to
the spoken engine while the screen was assumed to be reading the accurate one.
An in-process number cannot see that, because it never asks the sidecar which
engine it would have picked.

So this posts the same manifest through `POST /transcribe` over HTTP and sends
no `engine` field, which is exactly what the display path does. Whatever the
sidecar decides to answer with is what the number describes.

Normalization, WER, RTF and latency come from `stt_bench` unchanged, so results
are comparable with the harness's own tables rather than being a second opinion
computed a second way.

Usage:
  uv run --directory benchmarks/stt python scripts/measure_sidecar_wer.py
  uv run --directory benchmarks/stt python scripts/measure_sidecar_wer.py --engine nemotron
  uv run --directory benchmarks/stt python scripts/measure_sidecar_wer.py --lang en --json out.json
"""

import argparse
import json
import sys
import time
from pathlib import Path

import requests

SERVICE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVICE_ROOT))

from stt_bench.manifest import load_manifest  # noqa: E402
from stt_bench.metrics import corpus_wer, latency_stats, rtf  # noqa: E402

DEFAULT_URL = "http://localhost:8002"

# Long enough for a cold engine to answer the first utterance; the sidecar
# serializes on one warm recognizer, so a queued request waits on the one ahead.
REQUEST_TIMEOUT_S = 180


def transcribe(url: str, wav: Path, lang: str, engine: str | None) -> tuple[str, float]:
    """One utterance through the sidecar. Returns (text, wall seconds)."""
    data = {"language": lang}
    # Absent means "the language's default", which is the whole point of the
    # measurement. Only send the field when the caller named an engine.
    if engine:
        data["engine"] = engine
    with open(wav, "rb") as fh:
        started = time.perf_counter()
        response = requests.post(
            f"{url}/transcribe",
            files={"file": (wav.name, fh, "audio/wav")},
            data=data,
            timeout=REQUEST_TIMEOUT_S,
        )
        elapsed = time.perf_counter() - started
    response.raise_for_status()
    return response.json()["text"], elapsed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--lang", default="vi", choices=["vi", "en"])
    parser.add_argument(
        "--engine",
        default=None,
        help="Name an engine explicitly. Omit to measure what the app gets.",
    )
    parser.add_argument("--limit", type=int, default=0, help="0 = whole manifest")
    parser.add_argument("--json", type=Path, default=None, help="Write results here")
    args = parser.parse_args()

    health = requests.get(f"{args.url}/healthz", timeout=10)
    if health.status_code != 200:
        print(f"sidecar not ready: {health.status_code} {health.text}", file=sys.stderr)
        return 1

    manifest = SERVICE_ROOT / "data" / f"manifest-{args.lang}.jsonl"
    utterances = load_manifest(manifest)
    if args.limit:
        utterances = utterances[: args.limit]

    label = args.engine or "(sidecar default)"
    print(f"{len(utterances)} utterances, lang={args.lang}, engine={label}")

    refs: list[str] = []
    hyps: list[str] = []
    latencies: list[float] = []
    audio_seconds = 0.0
    rows = []

    for index, utt in enumerate(utterances, start=1):
        text, elapsed = transcribe(args.url, utt.audio_path, args.lang, args.engine)
        refs.append(utt.ref_text)
        hyps.append(text)
        latencies.append(elapsed)
        audio_seconds += utt.duration_s
        rows.append(
            {
                "id": utt.id,
                "ref": utt.ref_text,
                "hyp": text,
                "seconds": round(elapsed, 3),
                "duration_s": utt.duration_s,
            }
        )
        print(f"  [{index}/{len(utterances)}] {utt.id} {elapsed:.2f}s", flush=True)

    result = {
        "lang": args.lang,
        "engine_requested": args.engine,
        "utterances": len(utterances),
        "wer": corpus_wer(refs, hyps),
        "rtf": rtf(sum(latencies), audio_seconds),
        "latency": latency_stats(latencies),
        "audio_seconds": round(audio_seconds, 2),
    }

    print(f"\nWER  {result['wer'] * 100:.2f}%")
    print(f"RTF  {result['rtf']:.3f}  (over {result['audio_seconds']}s of audio)")
    print(f"p50  {result['latency']['p50_s']:.2f}s   p95 {result['latency']['p95_s']:.2f}s")

    if args.json:
        args.json.write_text(
            json.dumps({**result, "rows": rows}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"\nwrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
