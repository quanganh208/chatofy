"""Measure one arm — one (engine, voice, sentence-set) — in its own process.

Run via `run_benchmark.py`, which spawns this per arm so peak RSS reflects one
model and the arms never contend for the same cores.

**Result files are named for all three axes**, `{engine}__{voice}__{set}.jsonl`,
and the runner refuses to overwrite one without `--force`. The harness this was
vendored from names its output for the engine alone, which was unambiguous when
it measured one voice over one sentence set and is silent data loss here: the
second set's pass would overwrite the first's, leaving a perfectly well-formed
file containing half the run.

**The header is written first**, carrying the *expected* sentence count, and
every row is flushed as it is produced. The original writes its header after the
loop, so an arm that dies midway leaves WAVs on disk and no JSONL at all — and
the scoring stage, which walks the WAV tree, would then score a truncated subset
as though it were the whole set.

Each sentence is measured three ways in one pass, because two of the three are
nearly free once the engine is loaded:

- **whole** — the headline latency, and the time-to-first-audio a caller that
  does not stream gets, since there is nothing to hear until it finishes.
- **clause-split first part** — what the app actually waits for today. This is
  the TTFA number the verdict must beat, not the whole-sentence one.
- **streamed** — first audio-carrying chunk, plus the underrun margin, for an
  engine that streams.
"""

import argparse
import json
import platform
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

from .clause_split import split_into_clauses
from .engines.vieneu_vi import VieNeuVi
from .engines.zerotts_vi import ZeroTtsVi
from .measure import (
    PeakRssSampler,
    bench_threads,
    load_sentences,
    sentence_set_name,
)

ENGINES = {cls.engine_id: cls for cls in (VieNeuVi, ZeroTtsVi)}


def voice_slug(voice: str) -> str:
    """`Mai Anh` -> `mai-anh`; used in filenames and directory names."""
    return "".join(c if c.isalnum() else "-" for c in voice.lower()).strip("-")


def environment_block() -> dict:
    """What the numbers are conditional on.

    Recorded per arm because every earlier measurement in this repo was taken on
    Windows 11 and this machine is Ubuntu — a reader comparing against those
    figures needs to see the difference on the artifact, not infer it.
    """
    import importlib.metadata as md

    return {
        "os": platform.system(),
        "os_release": platform.release(),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "onnxruntime": md.version("onnxruntime"),
        "threads": bench_threads(),
        "hf_hub_offline": bool(int(__import__("os").environ.get("HF_HUB_OFFLINE", "0") or 0)),
    }


def measure_stream(engine, text: str, voice: str) -> dict:
    """Time the first audio-carrying chunk, and how far the stream stays ahead.

    Playback starts when the FIRST chunk lands, not when the call begins, so
    what the listener has consumed by wall time `t` is `t - ttfa`. The stream has
    delivered `cumulative_audio` by then. The worst value of
    `(t - ttfa) - cumulative_audio` over the stream is the underrun margin:
    positive anywhere means the generator fell behind the listener and the
    audio stalled.

    Measuring from `t0` instead would charge the stream for its own
    time-to-first-audio twice and report a stall that did not happen.

    A fast first chunk followed by a chunk generated slower than real time is an
    audible gap that a bare TTFA figure would still report as a win, and this
    repo already holds itself to the opposite standard: the app's clause
    splitter records that the first part's audio outlasts the time to synthesize
    the second, "so playback runs gapless".
    """
    sr = engine.sample_rate
    t0 = time.perf_counter()
    ttfa_s = None
    total_samples = 0
    worst_margin = float("-inf")
    chunks = []

    for chunk in engine.synthesize_stream(text, voice):
        now = time.perf_counter() - t0
        if chunk.size == 0:
            continue
        if ttfa_s is None:
            ttfa_s = now
        else:
            # Just before this chunk lands: consumed vs delivered so far.
            consumed_s = now - ttfa_s
            delivered_s = total_samples / sr
            worst_margin = max(worst_margin, consumed_s - delivered_s)
        total_samples += chunk.size
        chunks.append(chunk)

    return {
        "stream_ttfa_s": round(ttfa_s, 4) if ttfa_s is not None else None,
        "stream_total_s": round(time.perf_counter() - t0, 4),
        "stream_chunks": len(chunks),
        "stream_underrun_margin_s": (
            round(worst_margin, 4) if worst_margin != float("-inf") else None
        ),
        "stream_audio_s": round(total_samples / sr, 3),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", required=True, choices=sorted(ENGINES))
    parser.add_argument("--voice", required=True, help="voice token, verbatim")
    parser.add_argument("--gender", required=True, choices=["female", "male"])
    parser.add_argument("--sentences", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--force", action="store_true",
                        help="overwrite an existing result file for this arm")
    parser.add_argument("--no-stream", action="store_true",
                        help="skip the streaming pass even where supported")
    args = parser.parse_args()

    sentences = load_sentences(args.sentences)
    set_name = sentence_set_name(args.sentences)
    slug = voice_slug(args.voice)

    out_path = args.out_dir / f"{args.engine}__{slug}__{set_name}.jsonl"
    if out_path.exists() and not args.force:
        print(f"[error] {out_path} exists; pass --force to overwrite", file=sys.stderr)
        return 2
    wav_dir = args.out_dir / "wav" / args.engine / slug / set_name
    wav_dir.mkdir(parents=True, exist_ok=True)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    engine = ENGINES[args.engine]()
    sampler = PeakRssSampler().start()

    load_start = time.perf_counter()
    engine.load()
    load_s = time.perf_counter() - load_start

    # One untimed warm-up, on the SAME voice as the timed loop — a different
    # voice here would leave a per-voice initialization cost inside the first
    # timed sentence.
    engine.synthesize(sentences[0].text, args.voice)

    streaming = engine.supports_streaming and not args.no_stream
    if streaming:
        # The streamed path has its OWN first-call cost — a separate decoder
        # session on both engines — and warming only `synthesize` leaves it
        # inside the first measured stream, where it lands on `stream_ttfa_s`:
        # the one number this comparison turns on. Consumed to exhaustion,
        # because a generator abandoned early warms only what it reached.
        for _ in engine.synthesize_stream(sentences[0].text, args.voice):
            pass

    f = open(out_path, "w", encoding="utf-8")
    header = {
        "type": "header",
        "engine": args.engine,
        "voice": args.voice,
        "voice_slug": slug,
        "gender": args.gender,
        "sentence_set": set_name,
        "load_s": round(load_s, 3),
        # The EXPECTED count, written before the loop, so a file that ends early
        # is detectably short rather than plausibly complete.
        "num_sentences_expected": len(sentences),
        "sample_rate": engine.sample_rate,
        "supports_streaming": streaming,
        "decode_params": engine.decode_params(),
        "environment": environment_block(),
    }
    f.write(json.dumps(header, ensure_ascii=False) + "\n")
    f.flush()

    for sentence in sentences:
        t0 = time.perf_counter()
        samples, sr = engine.synthesize(sentence.text, args.voice)
        proc_s = time.perf_counter() - t0
        audio_s = samples.size / sr

        sf.write(wav_dir / f"{sentence.id}.wav", samples, sr, subtype="PCM_16")

        # What the app waits for today: the first clause only.
        parts = split_into_clauses(sentence.text)
        t0 = time.perf_counter()
        engine.synthesize(parts[0], args.voice)
        clause_ttfa_s = time.perf_counter() - t0

        n_words = len(sentence.text.split())
        record = {
            "type": "sentence",
            "engine": args.engine,
            "voice_slug": slug,
            "sentence_set": set_name,
            "sentence_id": sentence.id,
            "text": sentence.text,
            "tags": list(sentence.tags),
            "n_words": n_words,
            "n_clauses": len(parts),
            "audio_s": round(audio_s, 3),
            "proc_s": round(proc_s, 4),
            "rtf": round(proc_s / audio_s, 4) if audio_s > 0 else None,
            # Speaking rate. RTF is invariant to sample rate but NOT to how fast
            # an engine talks: render the same sentence 20% longer and RTF
            # improves 20% while the user waits longer to synthesize AND longer
            # to listen. Recorded so the report can say whether an RTF gap is
            # between engines or between prosody choices.
            "audio_s_per_word": round(audio_s / n_words, 4) if n_words else None,
            "latency_s_per_word": round(proc_s / n_words, 4) if n_words else None,
            # TTFA, all applicable ways.
            "ttfa_whole_s": round(proc_s, 4),
            "ttfa_clause_split_s": round(clause_ttfa_s, 4),
        }
        if streaming:
            record.update(measure_stream(engine, sentence.text, args.voice))

        f.write(json.dumps(record, ensure_ascii=False) + "\n")
        f.flush()
        print(f"[{args.engine}/{slug}/{set_name}] {sentence.id}: "
              f"{proc_s:.2f}s -> {audio_s:.1f}s audio", file=sys.stderr, flush=True)

    peak_rss_mb = sampler.stop()
    f.write(json.dumps({"type": "footer", "peak_rss_mb": round(peak_rss_mb, 1),
                        "num_sentences_written": len(sentences)},
                       ensure_ascii=False) + "\n")
    f.close()
    print(f"[{args.engine}/{slug}/{set_name}] wrote {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
