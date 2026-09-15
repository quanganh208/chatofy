"""Transcribe every synthesized WAV and score it — the intelligibility stage.

    uv run python score_intelligibility.py --run-tag r1
    uv run python score_intelligibility.py --check-complete

**The scoring judge is PhoWhisper-small. Zipformer-vi is a separate column, and
the two are never combined** — see `tts_vi_bench/asr_judges.py` for why a
min-of-two would move the between-system delta in an unpredictable direction and
would throw away the human-speech control floors.

WHAT THIS NUMBER IS NOT: the vendor's 1.03% WER was measured with
PhoWhisper-LARGE plus whisper-large-v3, taking the per-utterance minimum. This
is PhoWhisper-small alone. Absolute WER here will be higher for BOTH engines and
is meaningful only as a comparison between them. It is not comparable to 1.03%,
and the generated report says so on every table rather than only in the plan.

Completeness is a gate, not a listing: the arms are joined to the sentence set by
id and a mismatch fails, because a corpus WER computed over whatever WAVs
happened to exist is a plausible-looking number with nothing marking it as
partial.
"""

import argparse
import json
import sys
from pathlib import Path

from tts_vi_bench.asr_judges import (
    HUMAN_SPEECH_FLOOR_WER,
    JUDGES,
    SCORING_JUDGE,
)
from tts_vi_bench.measure import load_sentences
from tts_vi_bench.metrics import (
    corpus_cer,
    corpus_wer,
    paired_bootstrap_wer,
    win_loss_tie,
)
from tts_vi_bench.run_engine import voice_slug
from run_benchmark import RESULTS, RUN_TAGS, SENTENCE_SETS, arms

BENCH_ROOT = Path(__file__).resolve().parent


def sentences_for(set_name: str):
    return load_sentences(BENCH_ROOT / "data" / f"sentences-{set_name}.jsonl")


def wav_dir(tag: str, engine_id: str, voice: str, set_name: str) -> Path:
    return RESULTS / tag / "wav" / engine_id / voice_slug(voice) / set_name


def check_complete() -> int:
    problems = []
    for tag in RUN_TAGS:
        for set_name in SENTENCE_SETS:
            expected = {s.id for s in sentences_for(set_name)}
            for engine_id, _gender, voice in arms():
                d = wav_dir(tag, engine_id, voice, set_name)
                found = {p.stem for p in d.glob("*.wav")} if d.exists() else set()
                if found != expected:
                    problems.append(
                        f"{tag}/{engine_id}/{voice_slug(voice)}/{set_name}: "
                        f"{len(found)}/{len(expected)} wavs"
                        + (f", missing {sorted(expected - found)[:3]}..." if expected - found else "")
                    )
    if problems:
        print("INCOMPLETE — refusing to score a partial run:", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        return 1
    print("complete: every arm has a WAV for every sentence in its set")
    return 0


def transcribe_all(tag: str) -> dict:
    """{judge: {(engine, voice_slug, set): {sentence_id: hypothesis}}}"""
    out: dict = {}
    for judge_id, judge_cls in JUDGES.items():
        judge = judge_cls()
        judge.load()
        out[judge_id] = {}
        for set_name in SENTENCE_SETS:
            ids = [s.id for s in sentences_for(set_name)]
            for engine_id, _gender, voice in arms():
                d = wav_dir(tag, engine_id, voice, set_name)
                key = (engine_id, voice_slug(voice), set_name)
                out[judge_id][key] = {
                    sid: judge.transcribe(d / f"{sid}.wav") for sid in ids
                }
                print(f"[{judge_id}] {tag} {key} done", file=sys.stderr, flush=True)
    return out


def score_subset(sentences, hyps: dict, tag_filter=None) -> dict:
    rows = [s for s in sentences if tag_filter is None or tag_filter in s.tags]
    if not rows:
        return {}
    refs = [s.ref_text for s in rows]
    hyp = [hyps[s.id] for s in rows]
    return {"n": len(rows), "wer": corpus_wer(refs, hyp), "cer": corpus_cer(refs, hyp)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-tag", choices=RUN_TAGS)
    parser.add_argument("--check-complete", action="store_true")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    if args.check_complete:
        return check_complete()
    if not args.run_tag:
        parser.error("need --run-tag or --check-complete")
    if check_complete() != 0:
        return 1

    tag = args.run_tag
    hyps = transcribe_all(tag)

    per_sentence_path = RESULTS / tag / "intelligibility.jsonl"
    scores: dict = {}
    with open(per_sentence_path, "w", encoding="utf-8") as f:
        f.write(json.dumps({
            "type": "header", "run_tag": tag,
            "scoring_judge": SCORING_JUDGE,
            "judges": {jid: JUDGES[jid]().decode_params() for jid in JUDGES},
            "human_speech_floor_wer": HUMAN_SPEECH_FLOOR_WER,
            "caveat": (
                "PhoWhisper-SMALL scores here. The ZeroTTS vendor used "
                "PhoWhisper-large + whisper-large-v3 taking the per-utterance "
                "minimum, so absolute WER below is higher for BOTH engines and "
                "is NOT comparable to their 1.03%. Read it as a relative "
                "comparison between the two engines on identical sentences. "
                "WER measures intelligibility, not naturalness."
            ),
        }, ensure_ascii=False) + "\n")

        for set_name in SENTENCE_SETS:
            sentences = sentences_for(set_name)
            by_id = {s.id: s for s in sentences}
            for engine_id, _gender, voice in arms():
                key = (engine_id, voice_slug(voice), set_name)
                for sid, s in by_id.items():
                    f.write(json.dumps({
                        "type": "sentence", "run_tag": tag,
                        "engine": engine_id, "voice_slug": key[1],
                        "sentence_set": set_name, "sentence_id": sid,
                        "tags": list(s.tags), "reference": s.ref_text,
                        **{f"hyp_{jid}": hyps[jid][key][sid] for jid in JUDGES},
                    }, ensure_ascii=False) + "\n")

                for judge_id in JUDGES:
                    h = hyps[judge_id][key]
                    scores[(judge_id, *key)] = {
                        "all": score_subset(sentences, h),
                        "code_switch": score_subset(sentences, h, "code-switch"),
                    }

    summary_path = RESULTS / tag / "intelligibility-summary.json"
    summary = {
        "run_tag": tag,
        "scoring_judge": SCORING_JUDGE,
        "human_speech_floor_wer": HUMAN_SPEECH_FLOOR_WER,
        "scores": {"|".join(k): v for k, v in scores.items()},
    }

    # Paired bootstrap, scoring judge only, per sentence set: engine vs engine
    # at the same gender, so the comparison is not confounded by speaker.
    paired = {}
    for set_name in SENTENCE_SETS:
        sentences = sentences_for(set_name)
        refs = [s.ref_text for s in sentences]
        for gender in ("female", "male"):
            keys = {}
            for engine_id, g, voice in arms():
                if g == gender:
                    keys[engine_id] = (engine_id, voice_slug(voice), set_name)
            if len(keys) != 2:
                continue
            a_id, b_id = "zerotts-vi", "vieneu-vi"
            ha = [hyps[SCORING_JUDGE][keys[a_id]][s.id] for s in sentences]
            hb = [hyps[SCORING_JUDGE][keys[b_id]][s.id] for s in sentences]
            paired[f"{set_name}|{gender}|zerotts_vs_vieneu"] = {
                **paired_bootstrap_wer(refs, ha, hb),
                **win_loss_tie(refs, ha, hb),
                "note": "negative observed_diff favours zerotts; "
                        "an interval spanning zero is a tie",
            }
    summary["paired_bootstrap"] = paired
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[done] {per_sentence_path}")
    print(f"[done] {summary_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
