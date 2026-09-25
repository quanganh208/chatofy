import sys, json, csv, glob, os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from stt_bench.metrics import corpus_wer, corpus_cer
D = Path(sys.argv[1]); arms = sys.argv[2].split(","); REF = sys.argv[3] if len(sys.argv) > 3 else "ref"; LANGF = sys.argv[4] if len(sys.argv) > 4 else None
agg = {}
print(f"{'conv':9s} {'lang':4s} {'dur':>5s} " + " ".join(f"{a:>16s}" for a in arms))
for line in open(D / "index.tsv"):
    cid, _, direction = line.split("\t")[:3]; lang = "vi" if direction.startswith("vi") else "en"
    if LANGF and lang != LANGF: continue
    ref = " ".join(s["text"] for s in json.load(open(D / f"{cid}.{REF}.json")))
    cells = []
    for arm in arms:
        if arm == "prod":
            hyp = " ".join(r[3] for r in csv.reader(open(D / f"{cid}.turns.tsv"), delimiter="\t")); rtf = None
        else:
            f = D / f"{cid}.{arm}.json"
            if not f.exists(): cells.append(f"{'-':>16s}"); continue
            j = json.load(open(f)); hyp = j["text"]; rtf = j["proc_s"] / j["audio_s"]
        w, c = corpus_wer([ref], [hyp]), corpus_cer([ref], [hyp])
        agg.setdefault((lang, arm), []).append((ref, hyp))
        cells.append(f"{w*100:6.1f}/{c*100:5.1f}" + (f" {rtf:.2f}" if rtf is not None else "     "))
    dur = json.load(open(D / f"{cid}.ref.json"))[-1]["end"]
    print(f"{cid[:8]:9s} {lang:4s} {dur:5.0f} " + " ".join(cells))
print("\nPOOLED WER/CER per language")
for (lang, arm), pairs in sorted(agg.items()):
    print(f"{lang} {arm:12s} WER={corpus_wer(*zip(*pairs))*100:5.1f} CER={corpus_cer(*zip(*pairs))*100:5.1f}  n={len(pairs)}")
