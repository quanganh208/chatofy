"""Moonshine streaming — cùng bộ chỉ số với arm Nemotron, kèm arm diarization.

--speakers bật identify_speakers để đo CHI PHÍ của diarization. Không đo được độ
chính xác vì không có bộ test diarization tiếng Việt có nhãn; chi phí thì đo được.
"""
import argparse, json, sys, time
from pathlib import Path

import soundfile as sf
import moonshine_voice as mv
from moonshine_voice.transcriber import Transcriber

sys.path.insert(0, str(Path(__file__).parent))
from stream_metrics import stream_stats

import os
# Suy từ vị trí file (scripts/streaming-arms/ -> benchmarks/stt), cho phép
# override bằng STT_BENCH_ROOT khi chạy từ nơi khác.
BENCH = Path(os.environ.get("STT_BENCH_ROOT",
                            Path(__file__).resolve().parents[2]))


def text_of(tx) -> str:
    return " ".join(l.text for l in tx.lines).strip() if getattr(tx, "lines", None) else ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", default="vi")
    ap.add_argument("--manifest", default="data/manifest-vi.jsonl")
    ap.add_argument("--feed-ms", type=int, default=320)
    ap.add_argument("--mode", choices=["accuracy", "latency", "batch"], default="accuracy")
    ap.add_argument("--speakers", action="store_true")
    ap.add_argument("--arch", type=int, default=None,
                    help="2=tiny-streaming 4=small-streaming 5=medium-streaming")
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()

    want = mv.moonshine_api.ModelArch(a.arch) if a.arch is not None else None
    model_path, arch = mv.get_model_for_language(a.lang, want)
    opts = {}
    if a.speakers:
        # Tên và kiểu lấy từ CLI của chính package: chuỗi "true", và key là
        # diarization_model_dir chứ không phải _path.
        opts["identify_speakers"] = "true"
        opts["diarization_model_dir"] = mv.get_diarization_model()
    t0 = time.perf_counter()
    tr = Transcriber(model_path, model_arch=arch, options=opts or None)
    load_s = round(time.perf_counter() - t0, 3)

    rows = [json.loads(l) for l in (BENCH / a.manifest).open()]
    tag = f"moonshine-{a.lang}-a{int(arch)}-{a.mode}" + (f"-{a.feed_ms}ms" if a.mode != "batch" else "") \
          + ("-spk" if a.speakers else "")
    out = a.out.open("w")
    out.write(json.dumps({"type": "header", "engine": tag, "lang": a.lang,
        "load_s": load_s, "num_utterances": len(rows),
        "decode_params": {"model": str(model_path), "arch": int(arch),
                          "feed_ms": a.feed_ms, "mode": a.mode,
                          "identify_speakers": bool(a.speakers)}}, ensure_ascii=False) + "\n")

    for r in rows:
        audio, sr = sf.read(BENCH / "data" / r["audio_path"], dtype="float32")
        dur = len(audio) / sr
        if a.mode == "batch":
            t0 = time.perf_counter()
            tx = tr.transcribe_without_streaming(audio.tolist(), sr)
            proc = time.perf_counter() - t0
            text, stream = text_of(tx), None
            n_spk = None
        else:
            hop = int(sr * a.feed_ms / 1000)
            st = tr.create_stream(); st.start()
            snaps = []
            t0 = time.perf_counter()
            for i in range(0, len(audio), hop):
                st.add_audio(audio[i:i + hop].tolist(), sr)
                if a.mode == "latency":
                    snaps.append((min(len(audio), i + hop) / sr,
                                  time.perf_counter() - t0, text_of(st.update_transcription())))
            tx = st.update_transcription()
            proc = time.perf_counter() - t0
            text = text_of(tx)
            spans = [sp for l in tx.lines for sp in (l.speaker_spans or [])]
            n_spk = len({getattr(sp, "speaker", None) for sp in spans}) if spans else 0
            st.stop(); st.close()
            stream = stream_stats(snaps + [(dur, proc, text)]) if a.mode == "latency" else None

        row = {"type": "utterance", "utt_id": r["id"], "lang": a.lang,
               "ref_text": r["ref_text"], "hyp_text": text,
               "audio_s": round(dur, 3), "proc_s": round(proc, 4),
               "rtf": round(proc / dur, 4)}
        if stream: row["stream"] = stream
        if n_spk is not None: row["n_speakers"] = n_spk
        out.write(json.dumps(row, ensure_ascii=False) + "\n")
    out.close()
    print("wrote", a.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
