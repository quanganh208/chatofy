"""Render the same sentences with all eight ZeroTTS presets, for listening.

The two presets the benchmark measures are picked from these. That choice is a
perception result, so this script exists to make it reviewable rather than
asserted: it writes one WAV per preset per sentence and prints the manifest's
own style labels beside each, so the reason a preset was taken or rejected can
be checked against what it actually sounds like.

The current pick and its reasoning live in `tts_vi_bench/engines/zerotts_vi.py`.
"""

import json
import sys
from pathlib import Path

import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

OUT_DIR = Path(__file__).resolve().parent.parent / "results" / "audition"

#: Short, medium and code-switched — the three cases the app actually produces,
#: so a preset is auditioned on the work it would do rather than on one phrase.
SENTENCES = {
    "short": "Xin chào, cái này giá bao nhiêu?",
    "medium": "Tôi muốn đặt một bàn hai người lúc bảy giờ tối nay.",
    "codeswitch": "Cho tôi hỏi mật khẩu wifi ở đây là gì ạ?",
}


def main() -> int:
    import numpy as np
    from zerotts import ZeroTTS, hub

    from tts_vi_bench.engines.zerotts_vi import DEFAULTS
    from tts_vi_bench.measure import SEED, bench_threads

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tts = ZeroTTS.from_pretrained(
        hub.DEFAULT_REPO_ID,
        intra_op_num_threads=bench_threads(),
        codec_intra_op_num_threads=bench_threads(),
        warmup=False,
    )

    manifest = {
        v["name"]: v
        for v in json.loads(
            (Path(tts.model_dir) / "voices" / "index.json").read_text(encoding="utf-8")
        )["voices"]
    }

    chosen = set(DEFAULTS.values())
    for name in tts.list_voices():
        meta = manifest.get(name, {})
        mark = "  <- MEASURED" if name in chosen else ""
        print(f"{name:<12} {meta.get('gender','?'):<4} {meta.get('description','')}{mark}")
        for label, text in SENTENCES.items():
            np.random.seed(SEED)
            audio = tts.synthesize(text, voice=name)
            samples = np.asarray(audio, dtype="float32").reshape(-1)
            sf.write(OUT_DIR / f"{name}-{label}.wav", samples, tts.sample_rate,
                     subtype="PCM_16")

    print(f"\n[done] {len(tts.list_voices()) * len(SENTENCES)} clips in {OUT_DIR}")
    print(f"[pick] female={DEFAULTS['female']}  male={DEFAULTS['male']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
