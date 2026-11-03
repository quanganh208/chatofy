"""Can CAM++ tell who said a short piece (the planner's unjudged < 500 ms pieces)?

For every piece of speech bounded by >= 300 ms word gaps (Scribe v2, diarized),
embed it and compare against two references cut from the same recording:
  same  = nearby speech by the true speaker (the rest of its Scribe turn, else
          its previous/next turn), up to 4 s;
  other = the adjacent turn by a different speaker, up to 4 s.
Prints per-duration-band accuracy of "closer to same than other" and the cosine
distributions a one-reference threshold would have to separate.
"""
import json
import sys
from pathlib import Path

import av
import numpy as np
import sherpa_onnx

ROOT = Path(__file__).parent / "data"
SR = 16000
GAP = 0.3
REF_MAX = 4.0

cfg = sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(ROOT / "campplus.onnx"), num_threads=4)
ext = sherpa_onnx.SpeakerEmbeddingExtractor(cfg)


def decode(path):
    out = []
    with av.open(str(path)) as c:
        rs = av.AudioResampler(format="flt", layout="mono", rate=SR)
        for frame in c.decode(audio=0):
            for f in rs.resample(frame):
                out.append(f.to_ndarray().reshape(-1))
    return np.concatenate(out).astype(np.float32)


def embed(x):
    s = ext.create_stream()
    s.accept_waveform(SR, x)
    s.input_finished()
    v = np.asarray(ext.compute(s), dtype=np.float32)
    n = np.linalg.norm(v)
    return v / n if n else v


def clip(audio, spans, cap=REF_MAX):
    parts, total = [], 0.0
    for a, b in spans:
        take = min(b - a, cap - total)
        if take <= 0:
            break
        parts.append(audio[int(a * SR): int((a + take) * SR)])
        total += take
    return (np.concatenate(parts) if parts else np.zeros(0, np.float32)), total


rows = []
for scribe_path in sorted((ROOT / "scribe").glob("*.json")):
    rid = scribe_path.stem
    words = [w for w in json.load(open(scribe_path))["words"] if w["type"] == "word"]
    if len({w["speaker_id"] for w in words}) < 2:
        continue
    audio = decode(ROOT / "audio" / f"{rid}.webm")
    # Scribe turns, then pieces inside each turn split at >= GAP word gaps.
    turns = []
    for w in words:
        if turns and turns[-1]["spk"] == w["speaker_id"]:
            turns[-1]["words"].append(w)
        else:
            turns.append({"spk": w["speaker_id"], "words": [w]})
    for t in turns:
        pieces, cur = [], [t["words"][0]]
        for w in t["words"][1:]:
            if w["start"] - cur[-1]["end"] >= GAP:
                pieces.append(cur)
                cur = [w]
            else:
                cur.append(w)
        pieces.append(cur)
        t["pieces"] = [(p[0]["start"], p[-1]["end"], " ".join(x["text"] for x in p)) for p in pieces]
    for ti, t in enumerate(turns):
        for pi, (a, b, text) in enumerate(t["pieces"]):
            dur = b - a
            if dur < 0.15 or dur >= 1.5:
                continue
            edge = "first" if pi == 0 else ("last" if pi == len(t["pieces"]) - 1 else "inner")
            # same-speaker reference: rest of this turn, else nearest same-speaker turn
            same_spans = [(x, y) for k, (x, y, _) in enumerate(t["pieces"]) if k != pi]
            if sum(y - x for x, y in same_spans) < 1.0:
                for d in (1, -1, 2, -2, 3, -3):
                    j = ti + d
                    if 0 <= j < len(turns) and turns[j]["spk"] == t["spk"]:
                        same_spans += [(x, y) for x, y, _ in turns[j]["pieces"]]
                        break
            # other-speaker reference: the adjacent turn on the piece's side
            j = ti - 1 if edge == "first" else ti + 1
            if not (0 <= j < len(turns)):
                j = ti + 1 if j < 0 else ti - 1
            if not (0 <= j < len(turns)) or turns[j]["spk"] == t["spk"]:
                continue
            other_spans = [(x, y) for x, y, _ in turns[j]["pieces"]]
            if edge == "first":
                other_spans = other_spans[::-1]  # closest speech first
            same, ls = clip(audio, same_spans)
            other, lo = clip(audio, other_spans)
            if ls < 1.0 or lo < 1.0:
                continue
            p = embed(audio[int(a * SR): int(b * SR)])
            cs = float(p @ embed(same))
            co = float(p @ embed(other))
            rows.append({"rid": rid, "t": round(a, 2), "dur": dur, "edge": edge, "cs": cs, "co": co, "text": text})
    print(rid, "done", file=sys.stderr)

json.dump(rows, open(ROOT / "short-piece-rows.json", "w"))
bands = [(0.15, 0.3), (0.3, 0.4), (0.4, 0.5), (0.5, 0.75), (0.75, 1.5)]
print(f"{'band':>10} {'n':>4} {'argmax acc':>10} {'cs p10':>7} {'co p90':>7} {'acc@cs<0.35 flags other':>8}")
for lo, hi in bands:
    r = [x for x in rows if lo <= x["dur"] < hi]
    if not r:
        continue
    acc = np.mean([x["cs"] > x["co"] for x in r])
    cs = np.array([x["cs"] for x in r])
    co = np.array([x["co"] for x in r])
    print(f"{lo:.2f}-{hi:.2f} {len(r):>4} {acc:>10.3f} {np.percentile(cs,10):>7.3f} {np.percentile(co,90):>7.3f} same<0.35={np.mean(cs<0.35):.3f} other>=0.35={np.mean(co>=0.35):.3f}")
