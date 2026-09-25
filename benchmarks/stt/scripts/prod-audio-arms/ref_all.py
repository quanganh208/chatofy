import sys, json, os, numpy as np, soundfile as sf
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio
d = sys.argv[1]
m = WhisperModel("large-v3", device="cpu", compute_type="int8", cpu_threads=8)
for line in open(os.path.join(d, "index.tsv")):
    cid, _id, direction = line.split("\t")[:3]
    lang = "vi" if direction.startswith("vi") else "en"
    wav = os.path.join(d, cid + ".wav")
    a = decode_audio(os.path.join(d, cid + ".webm"), sampling_rate=16000)
    sf.write(wav, a, 16000, subtype="PCM_16")
    out = os.path.join(d, cid + ".ref.json")
    if os.path.exists(out): continue
    segs, _ = m.transcribe(a, language=lang, beam_size=5, word_timestamps=True, vad_filter=True, condition_on_previous_text=False)
    res = [{"start": s.start, "end": s.end, "text": s.text, "words": [[w.start, w.end, w.word] for w in s.words]} for s in segs]
    json.dump(res, open(out, "w"), ensure_ascii=False)
    print(cid, lang, len(a)/16000, "done", flush=True)
