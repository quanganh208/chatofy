"""Nemotron-3.5 streaming int8 — đo cả độ chính xác lẫn hành vi streaming.

Hai chế độ:
  accuracy  đút chunk, chỉ đọc kết quả ở cuối. Đây là số so WER với incumbent.
  latency   đút chunk và đọc hypothesis SAU MỖI CHUNK. Đây là workload thật của
            một client streaming, và là chế độ duy nhất nói được về độ trễ hiển
            thị và tỉ lệ viết lại.
"""
import argparse, json, sys, time
from pathlib import Path

import soundfile as sf
import sherpa_onnx

sys.path.insert(0, str(Path(__file__).parent))
from stream_metrics import stream_stats

import os
# Suy từ vị trí file (scripts/streaming-arms/ -> benchmarks/stt), cho phép
# override bằng STT_BENCH_ROOT khi chạy từ nơi khác.
BENCH = Path(os.environ.get("STT_BENCH_ROOT",
                            Path(__file__).resolve().parents[2]))


def build(pkg_ms: int, threads: int):
    d = BENCH / f"models/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-{pkg_ms}ms-int8-2026-06-11"
    t0 = time.perf_counter()
    rec = sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=str(d / "tokens.txt"), encoder=str(d / "encoder.int8.onnx"),
        decoder=str(d / "decoder.int8.onnx"), joiner=str(d / "joiner.int8.onnx"),
        num_threads=threads, model_type="nemotron", decoding_method="greedy_search")
    return rec, round(time.perf_counter() - t0, 3), d.name


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pkg-ms", type=int, required=True)
    ap.add_argument("--feed-ms", type=int, default=None, help="mặc định = pkg-ms")
    ap.add_argument("--lang", default="vi")
    ap.add_argument("--manifest", default="data/manifest-vi.jsonl")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--mode", choices=["accuracy", "latency"], default="accuracy")
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    feed_ms = a.feed_ms or a.pkg_ms

    rec, load_s, pkg = build(a.pkg_ms, a.threads)
    rows = [json.loads(l) for l in (BENCH / a.manifest).open()]
    out = a.out.open("w")
    out.write(json.dumps({
        "type": "header",
        "engine": f"nemotron-{a.pkg_ms}ms-{a.lang}-t{a.threads}-{a.mode}",
        "lang": a.lang, "load_s": load_s, "num_utterances": len(rows),
        "decode_params": {"model": pkg, "pkg_ms": a.pkg_ms, "feed_ms": feed_ms,
                          "num_threads": a.threads, "language": a.lang,
                          "mode": a.mode, "decoding_method": "greedy_search"},
    }, ensure_ascii=False) + "\n")

    for r in rows:
        audio, sr = sf.read(BENCH / "data" / r["audio_path"], dtype="float32")
        hop = int(sr * feed_ms / 1000)
        s = rec.create_stream()
        s.set_option("language", a.lang)

        snaps = []
        t0 = time.perf_counter()
        for i in range(0, len(audio), hop):
            s.accept_waveform(sr, audio[i:i + hop])
            while rec.is_ready(s):
                rec.decode_stream(s)
            if a.mode == "latency":
                snaps.append((min(len(audio), i + hop) / sr,
                              time.perf_counter() - t0, rec.get_result(s)))
        s.accept_waveform(sr, [0.0] * int(sr * 0.5))
        s.input_finished()
        while rec.is_ready(s):
            rec.decode_stream(s)
        proc = time.perf_counter() - t0
        text = rec.get_result(s)

        row = {"type": "utterance", "utt_id": r["id"], "lang": a.lang,
               "ref_text": r["ref_text"], "hyp_text": text,
               "audio_s": round(len(audio) / sr, 3), "proc_s": round(proc, 4),
               "rtf": round(proc / (len(audio) / sr), 4)}
        if a.mode == "latency":
            snaps.append((len(audio) / sr, proc, text))
            row["stream"] = stream_stats(snaps)
        out.write(json.dumps(row, ensure_ascii=False) + "\n")
    out.close()
    print("wrote", a.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
