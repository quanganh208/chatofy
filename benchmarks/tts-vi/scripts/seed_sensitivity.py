"""How much does each engine's intelligibility move from one run to the next?

The main benchmark scores each arm once per run tag. That is enough for latency,
where the two tags bracket the spread — and NOT enough for WER, because both
engines turn out to vary run to run for different reasons:

Both engines sample from the global numpy RNG every frame, and neither exposes a
seed parameter — so for both, the headline WER is ONE draw from a distribution
and a different seed is a different draw.

An earlier version of this script treated VieNeu as sampler-less and measured it
by bare repeats. Those repeats were a seed sweep in disguise, drawing whatever
seed the interpreter happened to hold; the spread they measured is still a valid
sample of the distribution. What changed is that the seed is now stated, so a
pass can be reproduced instead of only resampled.

If either spread is comparable to the gap between the engines, that gap is not a
property of the engines and no verdict can rest on it. This script measures both
spreads so they can be set beside the gap.

Writes to `results/seed-sensitivity/`; touches nothing the main run produced.

    uv run python scripts/seed_sensitivity.py --engine zerotts-vi --voice baotrang --seeds 11,22,33
    uv run python scripts/seed_sensitivity.py --engine vieneu-vi --voice "Mai Anh" --seeds 11,22,33
"""

import argparse
import json
import sys
import unicodedata
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tts_vi_bench.asr_judges import PhoWhisperJudge  # noqa: E402
from tts_vi_bench.engines.vieneu_vi import VieNeuVi  # noqa: E402
from tts_vi_bench.engines.zerotts_vi import ZeroTtsVi  # noqa: E402
from tts_vi_bench.measure import load_sentences  # noqa: E402
from tts_vi_bench.metrics import corpus_cer, corpus_wer  # noqa: E402

BENCH_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = BENCH_ROOT / "results" / "seed-sensitivity"


def summary_name(engine: str, voice: str, sentence_set: str) -> str:
    """One summary file per (engine, voice, sentence set).

    A single fixed `summary.json` meant the second voice's sweep silently
    replaced the first's, and a run on another sentence set replaced both. Every
    axis a run can vary on is in the name so no run can overwrite another.
    """
    ascii_voice = (unicodedata.normalize("NFKD", voice)
                   .encode("ascii", "ignore").decode().lower())
    slug = "-".join(ascii_voice.split())
    return f"summary-{engine}-{slug}-{sentence_set}.json"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", default="zerotts-vi",
                        choices=["zerotts-vi", "vieneu-vi"])
    parser.add_argument("--voice", default="baotrang")
    parser.add_argument("--seeds", default="11,22,33",
                        help="one pass per seed, on either engine")
    parser.add_argument(
        "--sentences", type=Path,
        default=BENCH_ROOT / "data" / "sentences-conversational.jsonl")
    args = parser.parse_args()

    sentences = load_sentences(args.sentences)
    is_zero = args.engine == "zerotts-vi"
    passes = [int(s) for s in args.seeds.split(",")]

    engine = ZeroTtsVi() if is_zero else VieNeuVi()
    engine.load()
    judge = PhoWhisperJudge()
    judge.load()

    rows = []
    for label in passes:
        wav_dir = (OUT_DIR / args.engine / f"pass-{label}" / args.sentences.stem
                   / args.voice.replace(" ", "-"))
        wav_dir.mkdir(parents=True, exist_ok=True)
        hyps, refs = [], []
        for s in sentences:
            # Override the module-level seed for this pass only, by seeding
            # here and calling the underlying package directly. Going through
            # `engine.synthesize` would re-seed to `measure.SEED` and every pass
            # would return the same audio — a spread of exactly zero, measured
            # from nothing. Seeding here also keeps each engine's recorded
            # decode_params honest about what the MAIN run used.
            np.random.seed(label)
            if is_zero:
                samples = engine._tts.synthesize(s.text, voice=args.voice)
            else:
                samples = engine._engine.infer(s.text, voice=str(args.voice))
            samples = np.asarray(samples, dtype=np.float32).reshape(-1)
            path = wav_dir / f"{s.id}.wav"
            sf.write(path, samples, engine.sample_rate, subtype="PCM_16")
            hyps.append(judge.transcribe(path))
            refs.append(s.ref_text)
        wer, cer = corpus_wer(refs, hyps), corpus_cer(refs, hyps)
        rows.append({"pass": label, "engine": args.engine, "voice": args.voice,
                     "wer": wer, "cer": cer, "n": len(sentences)})
        print(f"seed {label}: WER {wer*100:.2f}%  CER {cer*100:.2f}%", flush=True)

    wers = [r["wer"] for r in rows]
    spread = max(wers) - min(wers)
    summary = {
        "engine": args.engine,
        "voice": args.voice,
        "sentence_set": args.sentences.stem,
        "judge": judge.judge_id,
        "runs": rows,
        "wer_spread_pp": spread * 100,
        "note": (
            "Compare wer_spread_pp against the ZeroTTS-minus-VieNeu gap in "
            "results/<tag>/intelligibility-summary.json. A spread of the same "
            "order as the gap means the gap is not a property of the engines "
            "and no verdict can rest on it."
        ),
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / summary_name(args.engine, args.voice, args.sentences.stem)
    out_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    mean = sum(wers) / len(wers)
    print(f"\n{args.engine}/{args.voice}: mean WER {mean*100:.2f}%  "
          f"range {min(wers)*100:.2f}-{max(wers)*100:.2f}%  spread {spread*100:.2f}pp")
    print(f"[done] {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
