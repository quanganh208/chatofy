"""Does clause splitting change intelligibility? Score the path the app ships.

    uv run python score_clause_split.py --engine zerotts-vi --voice baotrang --draws 20260914,11,22
    uv run python score_clause_split.py --engine vieneu-vi --voice "Mai Anh" --draws 20260914,11,22

`run_engine.py` retains and scores WHOLE-SENTENCE audio, but
`translation-session.service.ts` never synthesizes a whole sentence: it calls
`splitIntoClauses` and pushes one WAV per clause, back to back, with no silence
inserted between them. So the existing WER figures describe audio no user hears.
This script measures the shipped path.

**Both paths are measured in the same process, in the same draw, sentence by
sentence.** That is the whole point of the design. The main report's open
question records the same seed producing 5.75% in one call sequence and 6.98% in
another, suspected ONNX Runtime state carried across calls — so scoring
clause-split here and differencing it against a number from a previous process
would measure that drift as though it were the splitting effect. Pairing within a
draw removes it: whole and clause see the same engine state, one sentence apart.

The listener's audio is the concatenation of the clause WAVs, so that is what is
scored — `np.concatenate`, no gap, no crossfade, matching `streamClauses`.

**18 of the 41 conversational sentences carry one clause**, where splitting is a
no-op and the two paths are the same call. They are included in the corpus figure
so it stays comparable to the main report, and excluded in the `split_affected`
figure so the effect is not diluted by 44% of rows that cannot show one.

**A same-path control runs alongside**, because the difference between two paths
is only meaningful against the difference between two runs of ONE path. Both
engines sample per frame, so a raw whole-versus-clause gap is part splitting
effect and part the engine's own noise, with no way to tell the shares apart.
Each sentence is therefore synthesized whole TWICE within a draw.
`control_delta` is the second whole against the first — what this engine does
when nothing changes at all. A `split_delta` no larger than `control_delta` is
not evidence that splitting did anything.

The control only works because the two whole passes are NOT re-seeded to the same
value: seeding is applied once per draw, not once per call, so the second pass
continues the RNG stream. Seeding each call identically would make the control
exactly zero and the comparison meaningless.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tts_vi_bench.asr_judges import PhoWhisperJudge  # noqa: E402
from tts_vi_bench.clause_split import split_into_clauses  # noqa: E402
from tts_vi_bench.engines.vieneu_vi import VieNeuVi  # noqa: E402
from tts_vi_bench.engines.zerotts_vi import ZeroTtsVi  # noqa: E402
from tts_vi_bench.measure import load_sentences  # noqa: E402
from tts_vi_bench.metrics import corpus_cer, corpus_wer, paired_bootstrap_wer  # noqa: E402
from tts_vi_bench.run_engine import voice_slug  # noqa: E402

BENCH_ROOT = Path(__file__).resolve().parent
OUT_DIR = BENCH_ROOT / "results" / "clause-split"
ENGINES = {cls.engine_id: cls for cls in (VieNeuVi, ZeroTtsVi)}


def synth(engine, text: str, voice: str) -> np.ndarray:
    """One synthesis call, reaching past the adapter so the draw is not re-seeded.

    Both engines draw from the global RNG per frame. The seed for a draw is set
    once, by the caller, before the draw's first call — going through
    `engine.synthesize` here would re-seed every call to `measure.SEED`, making
    the same-path control identically zero and the split effect unmeasurable
    against it. Reaching past the adapter also keeps each engine's recorded
    `decode_params` honest about what the MAIN run used, which is the same reason
    `scripts/seed_sensitivity.py` does it this way.
    """
    if hasattr(engine, "_tts"):
        samples = engine._tts.synthesize(text, voice=voice)
    else:
        samples = engine._engine.infer(text, voice=str(voice))
    return np.asarray(samples, dtype=np.float32).reshape(-1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", required=True, choices=sorted(ENGINES))
    parser.add_argument("--voice", required=True)
    parser.add_argument("--draws", default="20260914,11,22",
                        help="one seed per draw, on either engine")
    parser.add_argument("--sentences", type=Path,
                        default=BENCH_ROOT / "data" / "sentences-conversational.jsonl")
    parser.add_argument("--limit", type=int, default=None,
                        help="smoke-test on the first N sentences")
    parser.add_argument("--keep-wavs", action="store_true",
                        help="retain audio for both paths (a MOS panel would need it)")
    args = parser.parse_args()

    sentences = load_sentences(args.sentences)
    if args.limit:
        sentences = sentences[: args.limit]
    draws = [int(d) for d in args.draws.split(",")]
    slug = voice_slug(args.voice)

    # Which rows can show an effect at all.
    split_map = {s.id: split_into_clauses(s.text) for s in sentences}
    affected = {sid for sid, parts in split_map.items() if len(parts) > 1}
    print(f"[setup] {len(sentences)} sentences, {sum(len(p) for p in split_map.values())} "
          f"clauses, {len(affected)} sentences actually split", flush=True)

    engine = ENGINES[args.engine]()
    engine.load()
    judge = PhoWhisperJudge()
    judge.load()

    arm_dir = OUT_DIR / f"{args.engine}__{slug}"
    arm_dir.mkdir(parents=True, exist_ok=True)
    out = arm_dir / "summary.json"

    # Resume. A draw costs minutes of synthesis and transcription, so an
    # interrupted arm reloads what it already paid for and runs only the rest.
    rows = []
    if out.exists():
        rows = json.loads(out.read_text(encoding="utf-8")).get("draws", [])
        have = {r["draw"] for r in rows}
        draws = [d for d in draws if d not in have]
        print(f"[resume] {len(have)} draw(s) already scored; {len(draws)} to go", flush=True)
        if not draws:
            print("[resume] nothing to do")
            return 0

    for draw in draws:
        # Seeded ONCE per draw, not once per call: the calls below then continue
        # one RNG stream, so the second whole pass is a genuine repeat rather
        # than a copy of the first. A draw is reproducible as a whole sequence.
        np.random.seed(draw)
        refs, hyp_whole, hyp_clause, hyp_control = [], [], [], []
        wav_dir = arm_dir / f"draw-{draw}"
        for d in ("whole", "clause", "control"):
            (wav_dir / d).mkdir(parents=True, exist_ok=True)

        for s in sentences:
            # Whole, then clause, then whole again, for every sentence. The three
            # stay one call apart so in-process drift hits them alike, and the
            # repeat brackets the clause call so the control is not measured
            # under systematically later engine state than the thing it controls.
            whole = synth(engine, s.text, args.voice)
            parts = split_map[s.id]
            clause = np.concatenate(
                [synth(engine, p, args.voice) for p in parts]
            )
            control = synth(engine, s.text, args.voice)

            paths = {}
            for name, samples in (("whole", whole), ("clause", clause), ("control", control)):
                p = wav_dir / name / f"{s.id}.wav"
                sf.write(p, samples, engine.sample_rate, subtype="PCM_16")
                paths[name] = p

            refs.append(s.ref_text)
            hyp_whole.append(judge.transcribe(paths["whole"]))
            hyp_clause.append(judge.transcribe(paths["clause"]))
            hyp_control.append(judge.transcribe(paths["control"]))

            if not args.keep_wavs:
                for p in paths.values():
                    p.unlink()

        idx = [i for i, s in enumerate(sentences) if s.id in affected]
        sub = lambda xs: [xs[i] for i in idx]  # noqa: E731

        row = {
            "draw": draw,
            "engine": args.engine,
            "voice": args.voice,
            "n": len(sentences),
            "corpus": {
                "whole_wer": corpus_wer(refs, hyp_whole),
                "clause_wer": corpus_wer(refs, hyp_clause),
                "control_wer": corpus_wer(refs, hyp_control),
                "whole_cer": corpus_cer(refs, hyp_whole),
                "clause_cer": corpus_cer(refs, hyp_clause),
                "control_cer": corpus_cer(refs, hyp_control),
            },
            "split_affected": {
                "n": len(idx),
                "whole_wer": corpus_wer(sub(refs), sub(hyp_whole)),
                "clause_wer": corpus_wer(sub(refs), sub(hyp_clause)),
                "control_wer": corpus_wer(sub(refs), sub(hyp_control)),
                "whole_cer": corpus_cer(sub(refs), sub(hyp_whole)),
                "clause_cer": corpus_cer(sub(refs), sub(hyp_clause)),
                "control_cer": corpus_cer(sub(refs), sub(hyp_control)),
            },
            # clause - whole, so NEGATIVE means splitting HELPED.
            "bootstrap_clause_minus_whole": paired_bootstrap_wer(refs, hyp_clause, hyp_whole),
            # The same statistic for a change that IS nothing. Any interval the
            # split comparison produces has to be read against this one.
            "bootstrap_control_minus_whole": paired_bootstrap_wer(refs, hyp_control, hyp_whole),
        }
        rows.append(row)
        c, a = row["corpus"], row["split_affected"]
        print(f"[draw {draw}] corpus whole {c['whole_wer']*100:.2f}% -> clause "
              f"{c['clause_wer']*100:.2f}% ({(c['clause_wer']-c['whole_wer'])*100:+.2f}pp), "
              f"control {c['control_wer']*100:.2f}% ({(c['control_wer']-c['whole_wer'])*100:+.2f}pp) | "
              f"split-affected {a['whole_wer']*100:.2f}% -> {a['clause_wer']*100:.2f}% "
              f"({(a['clause_wer']-a['whole_wer'])*100:+.2f}pp), "
              f"control {(a['control_wer']-a['whole_wer'])*100:+.2f}pp",
              flush=True)

        if not args.keep_wavs:
            for d in ("whole", "clause", "control"):
                (wav_dir / d).rmdir()
            wav_dir.rmdir()

        # Checkpoint after every draw, not at the end of the arm. The first run
        # of this script lost 24 minutes to an interruption because the summary
        # was written once, last.
        out.write_text(
            json.dumps({"engine": args.engine, "voice": args.voice,
                        "judge": judge.judge_id, "draws": rows,
                        "complete": False}, ensure_ascii=False, indent=2),
            encoding="utf-8")

    def spread(key: str, scope: str) -> dict:
        d = [(r[scope][key] - r[scope]["whole_wer"]) * 100 for r in rows]
        return {"mean": sum(d) / len(d), "min": min(d), "max": max(d)}

    summary = {
        "engine": args.engine,
        "voice": args.voice,
        "sentence_set": args.sentences.stem,
        "judge": judge.judge_id,
        "n_sentences": len(sentences),
        "n_split_affected": len(affected),
        "draws": rows,
        "corpus_delta_pp": spread("clause_wer", "corpus"),
        "corpus_control_delta_pp": spread("control_wer", "corpus"),
        "split_affected_delta_pp": spread("clause_wer", "split_affected"),
        "split_affected_control_delta_pp": spread("control_wer", "split_affected"),
        "complete": True,
        "note": ("clause minus whole, so negative means clause splitting IMPROVED "
                 "intelligibility. Both paths measured in one process per draw, "
                 "one call apart, so in-process drift cannot masquerade as the "
                 "splitting effect. Read every delta against its control, which "
                 "is the same statistic computed for re-running the SAME path: a "
                 "split delta inside the control's range means splitting did "
                 "nothing this engine's own noise does not already do."),
    }
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n{args.engine}/{args.voice}: "
          f"corpus delta {summary['corpus_delta_pp']['mean']:+.2f}pp "
          f"(control {summary['corpus_control_delta_pp']['mean']:+.2f}pp) | "
          f"split-affected delta {summary['split_affected_delta_pp']['mean']:+.2f}pp "
          f"(control {summary['split_affected_control_delta_pp']['mean']:+.2f}pp)")
    print(f"[done] {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
