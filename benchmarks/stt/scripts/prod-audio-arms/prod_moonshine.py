"""Moonshine v2 streaming arms over whole prod recordings (continuous, 320ms feed)."""
import sys, json, time
from pathlib import Path
import soundfile as sf
import moonshine_voice as mv
from moonshine_voice.transcriber import Transcriber
D = Path(sys.argv[1])
def text_of(tx): return " ".join(l.text for l in tx.lines).strip() if getattr(tx, "lines", None) else ""
cache = {}
for line in open(D / "index.tsv"):
    cid, _, direction = line.split("\t")[:3]
    lang = "vi" if direction.startswith("vi") else "en"
    audio, sr = sf.read(D / f"{cid}.wav", dtype="float32")
    for arch in ([2, 4, 5] if lang == "en" else [2]):
        out = D / f"{cid}.ms-a{arch}.json"
        if out.exists(): continue
        key = (lang, arch)
        if key not in cache:
            p, a = mv.get_model_for_language(lang, mv.moonshine_api.ModelArch(arch)); cache[key] = Transcriber(p, model_arch=a)
        tr = cache[key]; hop = int(sr * 0.32)
        st = tr.create_stream(); st.start(); t0 = time.perf_counter()
        for i in range(0, len(audio), hop): st.add_audio(audio[i:i+hop].tolist(), sr)
        text = text_of(st.update_transcription()); proc = time.perf_counter() - t0; st.stop(); st.close()
        json.dump({"text": text, "proc_s": proc, "audio_s": len(audio)/sr}, open(out, "w"), ensure_ascii=False)
        print(cid[:8], lang, f"ms-a{arch}", f"rtf={proc/(len(audio)/sr):.3f}", flush=True)
