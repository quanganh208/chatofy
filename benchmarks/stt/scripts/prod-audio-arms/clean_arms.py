"""pcs / hyntS on the repo's clean manifests (VIVOS, LibriSpeech), latency mode, 320ms feed, 4 threads."""
import sys, json, time
from pathlib import Path
import numpy as np, soundfile as sf
sys.path.insert(0, "/home/quanganh208/Documents/QuangAnh/chatofy/benchmarks/stt/scripts/streaming-arms")
sys.path.insert(0, str(Path(__file__).parent))
from stream_metrics import stream_stats


BENCH = Path("/home/quanganh208/Documents/QuangAnh/chatofy/benchmarks/stt")
import sherpa_onnx
M = BENCH / "models"
def build(arm):
    if arm == "hyntS":
        d = M/"Zipformer-30M-RNNT-Streaming-6000h"; t = "epoch-31-avg-11-chunk-32-left-128.fp16.onnx"
        return sherpa_onnx.OnlineRecognizer.from_transducer(tokens=str(d/"tokens.txt"), encoder=str(d/f"encoder-{t}"), decoder=str(d/f"decoder-{t}"), joiner=str(d/f"joiner-{t}"), num_threads=4)
    d = M/"sherpa-onnx-streaming-zipformer-ar_en_id_ja_ru_th_vi_zh-2025-02-10"; t = "epoch-75-avg-11-chunk-16-left-128"
    return sherpa_onnx.OnlineRecognizer.from_transducer(tokens=str(d/"tokens.txt"), encoder=str(d/f"encoder-{t}.int8.onnx"), decoder=str(d/f"decoder-{t}.onnx"), joiner=str(d/f"joiner-{t}.int8.onnx"), num_threads=4)
for arm, lang in [("pcs","vi"),("pcs","en"),("hyntS","vi")]:
    rec = build(arm); out = open(BENCH/f"results/r10-prod-audio/{arm}-{lang}-clean.jsonl","w")
    for r in [json.loads(l) for l in open(BENCH/f"data/manifest-{lang}.jsonl")]:
        audio, sr = sf.read(BENCH/"data"/r["audio_path"], dtype="float32"); hop = int(sr*0.32)
        s = rec.create_stream(); snaps = []; t0 = time.perf_counter()
        for i in range(0, len(audio), hop):
            s.accept_waveform(sr, audio[i:i+hop])
            while rec.is_ready(s): rec.decode_stream(s)
            snaps.append((min(len(audio), i+hop)/sr, time.perf_counter()-t0, rec.get_result(s)))
        s.accept_waveform(sr, np.zeros(sr, dtype=np.float32)); s.input_finished()
        while rec.is_ready(s): rec.decode_stream(s)
        proc = time.perf_counter()-t0; text = rec.get_result(s); snaps.append((len(audio)/sr, proc, text))
        out.write(json.dumps({"type":"utterance","utt_id":r["id"],"lang":lang,"ref_text":r["ref_text"],"hyp_text":text,"audio_s":len(audio)/sr,"proc_s":proc,"stream":stream_stats(snaps)}, ensure_ascii=False)+"\n")
    out.close(); print("done", arm, lang, flush=True)
