import sys, json, os
from faster_whisper import WhisperModel
from huggingface_hub import snapshot_download
d = sys.argv[1]
m = WhisperModel(snapshot_download("thoaibuiic/PhoWhisper-large-ct2"), device="cpu", compute_type="int8", cpu_threads=8)
for line in open(os.path.join(d, "index.tsv")):
    cid, _id, direction = line.split("\t")[:3]
    if not direction.startswith("vi"): continue
    out = os.path.join(d, cid + ".pho.json")
    if os.path.exists(out): continue
    segs, _ = m.transcribe(os.path.join(d, cid + ".wav"), language="vi", beam_size=5, vad_filter=True, condition_on_previous_text=False)
    json.dump({"text": " ".join(s.text.strip() for s in segs), "proc_s": 0, "audio_s": 1}, open(out, "w"), ensure_ascii=False)
    print(cid, "done", flush=True)
