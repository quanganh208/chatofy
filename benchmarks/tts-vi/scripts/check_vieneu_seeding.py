"""Can VieNeu's run-to-run variance be pinned? Yes — it was never uncontrollable.

    uv run python scripts/check_vieneu_seeding.py /tmp/digests-a.json
    uv run python scripts/check_vieneu_seeding.py /tmp/digests-b.json   # second process

`engines/vieneu_vi.py` records `"seed": None, "stochastic": False` and the main
report states VieNeu "has no sampler at all and is still not byte-reproducible",
calling that unexplained and a reliability property of the shipping engine.

`Vieneu.infer` takes `temperature=0.8, top_k=25, top_p=0.95,
repetition_penalty=1.2` — the same sampling defaults ZeroTTS uses. VieNeu has a
sampler. It draws from numpy's global RNG, and nothing seeds it, which is the
whole of the mystery.

Measured here: unseeded 0/8 reproducible on both voices; seeded immediately
before each call, 8/8 within a process AND 8/8 across two processes. Greedy
decoding (`top_k=1`) pins it too, at a different and stable output.

The fix is the one `engines/zerotts_vi.py` already applies to the challenger.
Applying it to only one of two compared engines is what made the incumbent look
unreliable and the challenger look solid.
"""
import sys, hashlib, json
sys.path.insert(0,"/home/quanganh208/Documents/QuangAnh/chatofy/benchmarks/tts-vi")
from pathlib import Path
import numpy as np
from vieneu import Vieneu
from tts_vi_bench.measure import load_sentences

B=Path("/home/quanganh208/Documents/QuangAnh/chatofy/benchmarks/tts-vi")
sents=load_sentences(B/"data"/"sentences-conversational.jsonl")[:8]
h=lambda a: hashlib.sha256(np.ascontiguousarray(a,dtype=np.float32).tobytes()).hexdigest()[:16]
e=Vieneu(mode="v3turbo", precision="fp32", threads=8)
SEED=20260914
out={}
for voice in ("Mai Anh","Thanh Bình"):
    unseeded_stable=seeded_stable=0
    digests={}
    for s in sents:
        u=[h(np.asarray(e.infer(s.text,voice=voice),dtype=np.float32).reshape(-1)) for _ in range(2)]
        unseeded_stable += len(set(u))==1
        d=[]
        for _ in range(2):
            np.random.seed(SEED)
            d.append(h(np.asarray(e.infer(s.text,voice=voice),dtype=np.float32).reshape(-1)))
        seeded_stable += len(set(d))==1
        digests[s.id]=d[0]
    n=len(sents)
    print(f"{voice:12s}  unseeded reproducible {unseeded_stable}/{n}   seeded reproducible {seeded_stable}/{n}")
    out[voice]=digests
Path(sys.argv[1]).write_text(json.dumps(out,ensure_ascii=False,indent=2))
print("digests written for cross-process comparison")
