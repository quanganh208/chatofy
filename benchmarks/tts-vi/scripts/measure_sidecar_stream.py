"""Time the RUNNING sidecar's stream against the clause path the API used before.

The benchmark proper measures engines in-process. This measures the service the
app actually calls, over HTTP, so the numbers include everything a turn pays:
request, the engine lock, float-to-PCM conversion and chunked transfer.

Two arms per sentence, back to back on the same server:

- **stream** — `POST /synthesize/stream` with the whole sentence, timed by the
  benchmark's own `measure_stream`, so first chunk, underrun and gapless start
  mean exactly what they mean in `results/report.md`;
- **clause** — `POST /synthesize` with the sentence's FIRST clause only. That
  call is what the API's clause loop waited on before any sound, so its latency
  is the old path's time to first audio.

    uv run python scripts/measure_sidecar_stream.py --language vi --voice "Mai Anh"
    uv run python scripts/measure_sidecar_stream.py --language en --voice 9 \\
        --sentences ../tts/data/sentences-en.txt

A `.txt` set is one sentence per line — the English TTS benchmark's format.

Writes `results/sidecar-stream/<language>-<voice-slug>.json`.
"""

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

import httpx
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tts_vi_bench.clause_split import split_into_clauses  # noqa: E402
from tts_vi_bench.measure import Sentence, load_sentences  # noqa: E402
from tts_vi_bench.run_engine import measure_stream, voice_slug  # noqa: E402

BENCH_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = BENCH_ROOT / "results" / "sidecar-stream"
RATES = {"vi": 48000, "en": 24000}


class SidecarStream:
    """The `synthesize_stream` shape `measure_stream` drives, over HTTP."""

    def __init__(self, client: httpx.Client, url: str, language: str):
        self._client = client
        self._url = url
        self._language = language
        self.sample_rate = RATES[language]

    def synthesize_stream(self, text: str, voice: str):
        body = {"text": text, "language": self._language, "voice": voice}
        with self._client.stream("POST", f"{self._url}/synthesize/stream", json=body) as res:
            res.raise_for_status()
            announced = int(res.headers["x-sample-rate"])
            if announced != self.sample_rate:
                raise RuntimeError(f"sidecar announced {announced} Hz, expected {self.sample_rate}")
            carry = b""
            for raw in res.iter_raw():
                data = carry + raw
                whole = len(data) - len(data) % 2
                carry = data[whole:]
                if whole:
                    yield np.frombuffer(data[:whole], dtype="<i2").astype(np.float32) / 32768


def time_first_clause(client: httpx.Client, url: str, language: str, voice: str, text: str) -> float:
    first = split_into_clauses(text)[0]
    start = time.perf_counter()
    res = client.post(f"{url}/synthesize", json={"text": first, "language": language, "voice": voice})
    res.raise_for_status()
    return time.perf_counter() - start


def read_sentences(path: Path) -> list[Sentence]:
    if path.suffix != ".txt":
        return load_sentences(path)
    lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    return [
        Sentence(id=f"line-{n:03d}", text=text, ref_text=text, tags=())
        for n, text in enumerate((t for t in lines if t and not t.startswith("#")), 1)
    ]


def median_ms(values: list[float]) -> float:
    return round(statistics.median(values) * 1000, 1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="http://127.0.0.1:8003")
    parser.add_argument("--language", choices=sorted(RATES), required=True)
    parser.add_argument("--voice", required=True, help="catalog token, e.g. 'Mai Anh' or '9'")
    parser.add_argument("--sentences", type=Path,
                        default=BENCH_ROOT / "data" / "sentences-conversational.jsonl")
    args = parser.parse_args()

    sentences = read_sentences(args.sentences)
    rows = []
    with httpx.Client(timeout=60) as client:
        engine = SidecarStream(client, args.url, args.language)
        # One untimed call per arm, so neither pays a first-call cost the other does not.
        list(engine.synthesize_stream(sentences[0].text, args.voice))
        time_first_clause(client, args.url, args.language, args.voice, sentences[0].text)

        for s in sentences:
            stream = measure_stream(engine, s.text, args.voice)
            clause_s = time_first_clause(client, args.url, args.language, args.voice, s.text)
            margin = stream["stream_underrun_margin_s"]
            rows.append({
                "id": s.id,
                **stream,
                "gapless_start_s": round(stream["stream_ttfa_s"] + max(0.0, margin or 0.0), 4),
                "clause_first_audio_s": round(clause_s, 4),
            })
            print(f"{s.id}: stream {stream['stream_ttfa_s'] * 1000:.0f} ms, "
                  f"clause {clause_s * 1000:.0f} ms", flush=True)

    summary = {
        "language": args.language,
        "voice": args.voice,
        "sentence_set": args.sentences.stem,
        "n": len(rows),
        "stream_first_chunk_p50_ms": median_ms([r["stream_ttfa_s"] for r in rows]),
        "gapless_start_p50_ms": median_ms([r["gapless_start_s"] for r in rows]),
        "underrun_p50_ms": median_ms([r["stream_underrun_margin_s"] for r in rows
                                      if r["stream_underrun_margin_s"] is not None]),
        "starved_streams": sum(1 for r in rows if (r["stream_underrun_margin_s"] or 0) > 0),
        "clause_first_audio_p50_ms": median_ms([r["clause_first_audio_s"] for r in rows]),
        "rows": rows,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{args.language}-{voice_slug(args.voice)}-{args.sentences.stem}.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "rows"}, ensure_ascii=False, indent=2))
    print(f"[done] {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
