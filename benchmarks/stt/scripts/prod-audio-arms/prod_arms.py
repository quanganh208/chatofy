"""Run STT arms over prod recordings. Output: convs/<cid>.<arm>.json {text, proc_s, audio_s}.
Batch arms decode oracle segments (reference word gaps >=0.3s, <=8s) so segmentation errors are excluded.
Streaming arms consume the whole recording continuously (no turn cuts at all)."""
import sys, json, os, time, tempfile
from pathlib import Path
import numpy as np, soundfile as sf
BENCH = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BENCH))
D = Path(sys.argv[1]); arms = sys.argv[2].split(",")
os.environ.setdefault("STT_BENCH_THREADS", "4")

def segments(ref, max_s=8.0, gap=0.3):
    W = [w for s in ref for w in s["words"]]
    segs, cur = [], None
    for st, en, _ in W:
        if cur and (st - cur[1] >= gap or en - cur[0] > max_s):
            segs.append(cur); cur = None
        cur = [st, en] if cur is None else [cur[0], en]
    if cur: segs.append(cur)
    return [(max(0, a - 0.15), b + 0.25) for a, b in segs]

engines = {}
def batch(lang):
    if lang in engines: return engines[lang]
    from stt_bench.engines.sherpa_zipformer_vi import SherpaZipformerVi
    from stt_bench.engines.sherpa_moonshine_en import SherpaMoonshineEn
    e = SherpaZipformerVi() if lang == "vi" else SherpaMoonshineEn(); e.load(); engines[lang] = e; return e

nemo = {}
def nemotron(ms):
    if ms in nemo: return nemo[ms]
    import sherpa_onnx
    d = BENCH / f"models/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-{ms}ms-int8-2026-06-11"
    nemo[ms] = sherpa_onnx.OnlineRecognizer.from_transducer(tokens=str(d/"tokens.txt"), encoder=str(d/"encoder.int8.onnx"),
        decoder=str(d/"decoder.int8.onnx"), joiner=str(d/"joiner.int8.onnx"), num_threads=4, model_type="nemotron", decoding_method="greedy_search")
    return nemo[ms]

M = BENCH / "models"
ONLINE = {"hyntS", "pcs", "nemoen560", "puni560"}
OFFLINE = {"zf70k-oracle", "tdt-oracle"}
_rec = {}
def online(arm):
    if arm in _rec: return _rec[arm]
    import sherpa_onnx
    if arm == "hyntS":
        d = M/"Zipformer-30M-RNNT-Streaming-6000h"; t = "epoch-31-avg-11-chunk-32-left-128.fp16.onnx"
        r = sherpa_onnx.OnlineRecognizer.from_transducer(tokens=str(d/"tokens.txt"), encoder=str(d/f"encoder-{t}"), decoder=str(d/f"decoder-{t}"), joiner=str(d/f"joiner-{t}"), num_threads=4)
    elif arm == "pcs":
        d = M/"sherpa-onnx-streaming-zipformer-ar_en_id_ja_ru_th_vi_zh-2025-02-10"; t = "epoch-75-avg-11-chunk-16-left-128"
        r = sherpa_onnx.OnlineRecognizer.from_transducer(tokens=str(d/"tokens.txt"), encoder=str(d/f"encoder-{t}.int8.onnx"), decoder=str(d/f"decoder-{t}.onnx"), joiner=str(d/f"joiner-{t}.int8.onnx"), num_threads=4)
    else:
        d = M/("sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25" if arm == "nemoen560" else "sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-streaming-560ms")
        r = sherpa_onnx.OnlineRecognizer.from_transducer(tokens=str(d/"tokens.txt"), encoder=str(d/"encoder.int8.onnx"), decoder=str(d/"decoder.int8.onnx"), joiner=str(d/"joiner.int8.onnx"), num_threads=4, model_type=("nemotron" if arm == "nemoen560" else ""))
    _rec[arm] = r; return r
def offline(arm):
    if arm in _rec: return _rec[arm]
    import sherpa_onnx
    if arm == "zf70k-oracle":
        d = M/"sherpa-onnx-zipformer-vi-int8-2025-04-20"
        r = sherpa_onnx.OfflineRecognizer.from_transducer(tokens=str(d/"tokens.txt"), encoder=str(d/"encoder-epoch-12-avg-8.int8.onnx"), decoder=str(d/"decoder-epoch-12-avg-8.onnx"), joiner=str(d/"joiner-epoch-12-avg-8.int8.onnx"), num_threads=4)
    else:
        d = M/"sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"
        r = sherpa_onnx.OfflineRecognizer.from_transducer(tokens=str(d/"tokens.txt"), encoder=str(d/"encoder.int8.onnx"), decoder=str(d/"decoder.int8.onnx"), joiner=str(d/"joiner.int8.onnx"), num_threads=4, model_type="nemo_transducer")
    _rec[arm] = r; return r
LANG_OF = {"hyntS-prime3": "vi", "hyntS": "vi", "pcs": "both", "nemoen560": "en", "puni560": "en", "zf70k-oracle": "vi", "tdt-oracle": "en", "hyntS-oracle": "vi"}

for line in open(D / "index.tsv"):
    cid, _, direction = line.split("\t")[:3]
    lang = "vi" if direction.startswith("vi") else "en"
    audio, sr = sf.read(D / f"{cid}.wav", dtype="float32")
    ref = json.load(open(D / f"{cid}.ref.json"))
    for arm in arms:
        if LANG_OF.get(arm, "both") not in ("both", lang): continue
        out = D / f"{cid}.{arm}.json"
        if out.exists(): continue
        t0 = time.perf_counter()
        if arm == "cur-oracle":
            e = batch(lang); parts = []
            for a, b in segments(ref):
                with tempfile.NamedTemporaryFile(suffix=".wav") as f:
                    sf.write(f.name, audio[int(a*sr):int(b*sr)], sr); parts.append(e.transcribe(Path(f.name)))
            text = " ".join(parts)
        elif arm in ("nemo560", "nemo1120"):
            ms = int(arm[4:]); rec = nemotron(ms); s = rec.create_stream(); s.set_option("language", lang)
            hop = int(sr * ms / 1000)
            for i in range(0, len(audio), hop):
                s.accept_waveform(sr, audio[i:i+hop])
                while rec.is_ready(s): rec.decode_stream(s)
            s.accept_waveform(sr, np.zeros(sr//2, dtype=np.float32)); s.input_finished()
            while rec.is_ready(s): rec.decode_stream(s)
            text = rec.get_result(s)
        elif arm in ONLINE:
            rec = online(arm); s = rec.create_stream()
            if arm == "nemoen560": pass
            hop = int(sr * 0.32)
            for i in range(0, len(audio), hop):
                s.accept_waveform(sr, audio[i:i+hop])
                while rec.is_ready(s): rec.decode_stream(s)
            s.accept_waveform(sr, np.zeros(sr, dtype=np.float32)); s.input_finished()
            while rec.is_ready(s): rec.decode_stream(s)
            text = rec.get_result(s)
        elif arm.startswith("pcs-prime") or arm.startswith("hyntS-prime"):
            base, n = arm.split("-prime"); n = float(n); rec = online(base); parts = []
            for a, b in segments(ref):
                st = rec.create_stream(); p0 = max(0.0, a - n)
                if a - p0 > 0.05:
                    st.accept_waveform(sr, audio[int(p0*sr):int(a*sr)])
                    while rec.is_ready(st): rec.decode_stream(st)
                pre = rec.get_result(st)
                st.accept_waveform(sr, audio[int(a*sr):int(b*sr)]); st.accept_waveform(sr, np.zeros(sr, dtype=np.float32)); st.input_finished()
                while rec.is_ready(st): rec.decode_stream(st)
                full = rec.get_result(st)
                parts.append(full[len(pre):] if full.startswith(pre) else full)
            text = " ".join(parts)
        elif arm in ("pcs-oracle", "hyntS-oracle"):
            rec = online(arm.split("-")[0]); parts = []
            for a, b in segments(ref):
                st = rec.create_stream(); st.accept_waveform(sr, audio[int(a*sr):int(b*sr)])
                st.accept_waveform(sr, np.zeros(sr, dtype=np.float32)); st.input_finished()
                while rec.is_ready(st): rec.decode_stream(st)
                parts.append(rec.get_result(st))
            text = " ".join(parts)
        elif arm in OFFLINE:
            rec = offline(arm); parts = []
            for a, b in segments(ref):
                st = rec.create_stream(); st.accept_waveform(sr, audio[int(a*sr):int(b*sr)]); rec.decode_stream(st); parts.append(st.result.text)
            text = " ".join(parts)
        else:
            continue
        json.dump({"text": text, "proc_s": time.perf_counter()-t0, "audio_s": len(audio)/sr}, open(out, "w"), ensure_ascii=False)
        print(cid[:8], lang, arm, f"rtf={(time.perf_counter()-t0)/(len(audio)/sr):.3f}", flush=True)
