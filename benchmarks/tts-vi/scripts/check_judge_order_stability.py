"""Does the ASR judge's output depend on what it transcribed just before?

    uv run python scripts/check_judge_order_stability.py

Needs WAVs retained by score_clause_split.py --keep-wavs; the path is set below.

Uses the retained probe WAVs, so no synthesis runs: the audio is fixed and
byte-identical between the `whole` and `control` directories (verified 41/41).
Any difference in transcript is therefore the judge's alone.

Pass A transcribes whole[i] then immediately whole[i] again -- nothing between.
Pass B transcribes whole[i], then clause[i], then whole[i] -- one unrelated clip
between the two reads of the SAME file.
"""
import sys
from pathlib import Path
sys.path.insert(0,"/home/quanganh208/Documents/QuangAnh/chatofy/benchmarks/tts-vi")
from tts_vi_bench.asr_judges import PhoWhisperJudge
from tts_vi_bench.measure import load_sentences

B=Path("/home/quanganh208/Documents/QuangAnh/chatofy/benchmarks/tts-vi")
D=B/"results"/"clause-split-probe"/"zerotts-vi__baotrang"/"draw-20260914"
sents=load_sentences(B/"data"/"sentences-conversational.jsonl")
j=PhoWhisperJudge(); j.load()

back_to_back=0; interleaved=0; shown=0
for s in sents:
    w=D/"whole"/f"{s.id}.wav"; c=D/"clause"/f"{s.id}.wav"
    a1=j.transcribe(w); a2=j.transcribe(w)                 # nothing between
    b1=j.transcribe(w); _=j.transcribe(c); b2=j.transcribe(w)  # one clip between
    back_to_back += (a1!=a2)
    interleaved  += (b1!=b2)
    if b1!=b2 and shown<3:
        shown+=1
        print(f"{s.id} DIFFERS when interleaved:\n   before: {b1!r}\n   after : {b2!r}")
n=len(sents)
print(f"\nsame file twice, back to back        : {back_to_back}/{n} differed")
print(f"same file twice, one clip in between : {interleaved}/{n} differed")
