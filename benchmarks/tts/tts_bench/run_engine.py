"""Run ONE TTS engine over the sentence set; write results JSONL + WAVs.

Invoked as a standalone process per engine (RAM isolation):

    uv run python -m tts_bench.run_engine --engine sherpa-piper-en \
        --sentences data/sentences-en.txt --out-dir results/r1

Output: results/<tag>/<engine>.jsonl (header + per-sentence rows) and
results/<tag>/wav/<engine>/<sentence_id>.wav for A/B listening. Multi-speaker
engines take `--sid N` and write `<engine>-sidN.jsonl` and `wav/<engine>/sidN/`.
Each row carries the SHA-256 of the float32 samples, so two configurations can
be compared for bit-identical output without trusting a 16-bit WAV round trip. Warmup: the
first sentence is synthesized once untimed, then all sentences are timed.
RTF = synthesis wall time / duration of the GENERATED audio.
"""

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import soundfile as sf

from .engines import create_engine
from .measure import PeakRssSampler, load_sentences


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", required=True)
    parser.add_argument("--sentences", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--sid", type=int, help="speaker id (multi-speaker engines only)")
    args = parser.parse_args()

    engine = create_engine(args.engine, args.sid)
    sentences = load_sentences(args.sentences)
    run_name = engine.engine_id if args.sid is None else f"{engine.engine_id}-sid{args.sid}"
    wav_dir = args.out_dir / "wav" / engine.engine_id
    if args.sid is not None:
        wav_dir = wav_dir / f"sid{args.sid}"
    wav_dir.mkdir(parents=True, exist_ok=True)

    sampler = PeakRssSampler().start()

    load_start = time.perf_counter()
    engine.load()
    load_s = time.perf_counter() - load_start
    print(f"[{engine.engine_id}] loaded in {load_s:.2f}s", file=sys.stderr)

    # Warmup pays one-time costs (kernel JIT, allocator growth) untimed.
    engine.synthesize(sentences[0][1])

    records = []
    for sentence_id, text in sentences:
        start = time.perf_counter()
        samples, sample_rate = engine.synthesize(text)
        proc_s = time.perf_counter() - start
        audio_s = len(samples) / sample_rate
        sf.write(str(wav_dir / f"{sentence_id}.wav"), samples, sample_rate, subtype="PCM_16")
        records.append(
            {
                "type": "sentence",
                "engine": run_name,
                "sentence_id": sentence_id,
                "text": text,
                "n_words": len(text.split()),
                "audio_s": round(audio_s, 3),
                "n_samples": len(samples),
                "proc_s": round(proc_s, 4),
                "rtf": round(proc_s / audio_s, 4) if audio_s > 0 else None,
                "samples_sha256": hashlib.sha256(samples.tobytes()).hexdigest(),
            }
        )
        print(f"[{engine.engine_id}] {sentence_id}: {proc_s:.2f}s -> {audio_s:.1f}s audio", file=sys.stderr)

    peak_rss_mb = sampler.stop()
    header = {
        "type": "header",
        "engine": run_name,
        "load_s": round(load_s, 3),
        "peak_rss_mb": round(peak_rss_mb, 1),
        "num_sentences": len(records),
        "decode_params": engine.decode_params(),
    }

    out_path = args.out_dir / f"{run_name}.jsonl"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(header, ensure_ascii=False) + "\n")
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(f"[{engine.engine_id}] wrote {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
