"""Score rules for a short (< 500 ms) piece at the edge of a replayed turn.

Truth: the Scribe v2 (diarized) speaker of the words inside each piece.
Today: an unjudged edge piece rides with the turn's adjacent run.
Leading piece (first piece, turn has >= 2 pieces):
  R1  after a forced cut, give it to the previous turn's speaker;
  R2  give it to whichever is closer by CAM++: the previous turn's vector or
      the vector of the rest of this turn;
  R3  R2, but only after a forced cut.
Trailing piece (last piece): R4 compares against the NEXT turn's vector vs the
rest of this turn (needs the next turn, so it would be a retroactive move).
"""
import json
from collections import Counter
from pathlib import Path

import numpy as np
import sherpa_onnx

ROOT = Path(__file__).parent / "data"
SR = 16000
SHORT_MS = 500
ext = sherpa_onnx.SpeakerEmbeddingExtractor(
    sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(ROOT / "campplus.onnx"), num_threads=4)
)


def embed(x):
    s = ext.create_stream()
    s.accept_waveform(SR, x.astype(np.float32) / 32768)
    s.input_finished()
    v = np.asarray(ext.compute(s), dtype=np.float32)
    n = np.linalg.norm(v)
    return v / n if n else v


def truth(words, a, b):
    c = Counter(w["speaker_id"] for w in words if a <= (w["start"] + w["end"]) * 500 < b)
    return c.most_common(1)[0][0] if c else None


tally = Counter()
cases = []
for tp in sorted((ROOT / "turns").glob("*.json")):
    rid = tp.stem
    words = [w for w in json.load(open(ROOT / "scribe" / f"{rid}.json"))["words"] if w["type"] == "word"]
    if len({w["speaker_id"] for w in words}) < 2:
        continue
    pcm = np.fromfile(ROOT / "pcm" / f"{rid}.pcm", dtype="<i2")
    seg = lambda a, b: pcm[int(a * SR / 1000): int(b * SR / 1000)]
    turns = json.load(open(tp))
    for t in turns:
        t["truth"] = truth(words, t["startMs"], t["endMs"])
    for i, t in enumerate(turns):
        P = t["pieces"]
        if len(P) < 2:
            continue
        for side in ("lead", "trail"):
            p = P[0] if side == "lead" else P[-1]
            if p["endMs"] - p["startMs"] >= SHORT_MS:
                continue
            tp_ = truth(words, p["startMs"], p["endMs"])
            rest = P[1:] if side == "lead" else P[:-1]
            rest_truth = truth(words, rest[0]["startMs"], rest[-1]["endMs"])
            j = i - 1 if side == "lead" else i + 1
            if tp_ is None or rest_truth is None or not (0 <= j < len(turns)):
                continue
            nb = turns[j]
            forced = turns[i - 1]["reason"] == "forced" if side == "lead" else t["reason"] == "forced"
            gap = (t["startMs"] - nb["endMs"]) if side == "lead" else (nb["startMs"] - t["endMs"])
            v = embed(seg(p["startMs"], p["endMs"]))
            v_rest = embed(np.concatenate([seg(r["startMs"], r["endMs"]) for r in rest]))
            v_nb = embed(seg(nb["startMs"], nb["endMs"]))
            nb_truth = nb["truth"]
            closer_nb = float(v @ v_nb) > float(v @ v_rest)
            voices_differ = float(v_rest @ v_nb) < 0.35
            now_ok = tp_ == rest_truth
            row = dict(rid=rid, side=side, at=round(p["startMs"] / 1000, 2), dur=round(p["endMs"] - p["startMs"]),
                       forced=forced, truth=tp_, rest=rest_truth, nb=nb_truth, now_ok=now_ok,
                       closer_nb=closer_nb, differ=voices_differ, gap=round(gap))
            cases.append(row)

def score(name, rows, pick_nb):
    fixed = broken = changed = 0
    for r in rows:
        if not pick_nb(r):
            continue
        changed += 1
        new_ok = r["truth"] == r["nb"]
        if new_ok and not r["now_ok"]:
            fixed += 1
        if r["now_ok"] and not new_ok:
            broken += 1
    print(f"  {name:<44} moved {changed:>3}  fixed {fixed:>3}  broken {broken:>3}")

for side in ("lead", "trail"):
    rows = [r for r in cases if r["side"] == side]
    wrong = sum(not r["now_ok"] for r in rows)
    print(f"{side}: {len(rows)} short edge pieces, {wrong} wrong today")
    if side == "lead":
        score("R1 forced -> previous speaker", rows, lambda r: r["forced"])
        score("R1' forced & voices differ -> previous", rows, lambda r: r["forced"] and r["differ"])
        score("R2 closer to previous turn", rows, lambda r: r["closer_nb"])
        score("R3 forced & closer to previous", rows, lambda r: r["forced"] and r["closer_nb"])
        score("R3' forced & differ & closer to previous", rows, lambda r: r["forced"] and r["differ"] and r["closer_nb"])
    else:
        score("R4 closer to next turn", rows, lambda r: r["closer_nb"])
        score("R4' differ & closer to next turn", rows, lambda r: r["differ"] and r["closer_nb"])
json.dump(cases, open(ROOT / "edge-cases.json", "w"), indent=0)
print("\nwrong today:")
for r in cases:
    if not r["now_ok"]:
        print(" ", r)
