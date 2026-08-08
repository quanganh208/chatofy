"""Score what each arm actually SAID, not what it claims to have said.

The method is ASR-then-metric, which is the standard for speech-to-speech: take
each arm's output AUDIO, transcribe it with an ASR that sits in NEITHER arm, and
score those transcripts against reference translations.

Why not use the transcripts the systems already hand back:

  - the live arm's `outputTranscription` is the model's own report of its own
    speech, so scoring it measures the model's text and not its voice;
  - the cascade's target text is its MT stage's output, which its TTS may not
    have pronounced faithfully.

Scoring either would compare a text pipeline to a text pipeline and quietly drop
synthesis from the comparison.

Judge independence, concretely: Whisper large-v3 for English output and
PhoWhisper for Vietnamese. NOT ElevenLabs (an optional cascade backend), NOT
sherpa-onnx (the default cascade STT), NOT any Gemini model (the live arm, and
the cascade's MT stage). A committee will ask.

Usage:
    uv run python score-adequacy.py results/<stamp>/rows.jsonl
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent

# Whisper large-v3 for English, PhoWhisper-large for Vietnamese. Both are chosen
# for being outside both pipelines, not for being the most accurate available.
JUDGE_MODELS = {"en": "large-v3", "vi": "vinai/PhoWhisper-large"}

# Direction determines the OUTPUT language, which is what the judge transcribes.
OUTPUT_LANG = {"vi_to_en": "en", "en_to_vi": "vi"}


def load_rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def transcribe_en(paths: list[Path]) -> dict[Path, str]:
    from faster_whisper import WhisperModel

    model = WhisperModel(JUDGE_MODELS["en"], device="auto", compute_type="int8")
    out = {}
    for path in paths:
        segments, _ = model.transcribe(str(path), language="en", beam_size=5)
        out[path] = " ".join(s.text.strip() for s in segments).strip()
    return out


def transcribe_vi(paths: list[Path]) -> dict[Path, str]:
    import soundfile as sf
    import torch
    from transformers import pipeline

    asr = pipeline(
        "automatic-speech-recognition",
        model=JUDGE_MODELS["vi"],
        device=0 if torch.cuda.is_available() else -1,
    )
    out = {}
    for path in paths:
        audio, rate = sf.read(str(path))
        out[path] = asr({"raw": audio, "sampling_rate": rate})["text"].strip()
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    rows_path = Path(sys.argv[1])
    if not rows_path.is_file():
        # A traceback here tells the reader nothing they can act on, and the
        # path is easy to get wrong: the README's command is relative to this
        # directory, not to the repo root.
        print(
            f"no rows file at {rows_path}\n"
            f"(paths are relative to {Path.cwd()}; "
            "try an absolute path, or one of:)",
            file=sys.stderr,
        )
        for found in sorted(HERE.glob("results/*/rows.jsonl")):
            print(f"  {found}", file=sys.stderr)
        return 2
    rows = load_rows(rows_path)
    audio_dir = rows_path.parent / "audio"

    manifest = json.loads((HERE / "data" / "manifest.json").read_text())
    references = {u["id"]: u.get("referenceTranslation") for u in manifest["utterances"]}

    missing = [uid for uid, ref in references.items() if not ref]
    if missing:
        # Refused rather than scored against nothing. A run that silently skipped
        # the unreferenced utterances would report a number computed over a
        # subset nobody chose.
        print(
            f"{len(missing)} of {len(references)} utterances have no "
            "referenceTranslation. Fill them in data/manifest.json first — see "
            "the README on what counts as an acceptable reference.",
            file=sys.stderr,
        )
        return 1

    # Group by output language so each judge model is loaded once.
    by_lang: dict[str, list[tuple[dict, Path]]] = defaultdict(list)
    for row in rows:
        if row.get("error"):
            continue
        wav = audio_dir / f"{row['id']}-{row['arm']}.wav"
        if not wav.exists():
            continue
        by_lang[OUTPUT_LANG[row["direction"]]].append((row, wav))

    hypotheses: dict[tuple[str, str], str] = {}
    for lang, entries in by_lang.items():
        paths = [wav for _, wav in entries]
        print(f"judging {len(paths)} {lang} outputs with {JUDGE_MODELS[lang]}")
        texts = transcribe_en(paths) if lang == "en" else transcribe_vi(paths)
        for row, wav in entries:
            hypotheses[(row["arm"], row["id"])] = texts[wav]

    import sacrebleu
    from comet import download_model, load_from_checkpoint

    comet = load_from_checkpoint(download_model("Unbabel/wmt22-comet-da"))

    report = {}
    for arm in ("cascade", "live"):
        for direction in ("vi_to_en", "en_to_vi"):
            ids = [
                r["id"]
                for r in rows
                if r["arm"] == arm and r["direction"] == direction and (arm, r["id"]) in hypotheses
            ]
            if not ids:
                continue
            hyps = [hypotheses[(arm, i)] for i in ids]
            refs = [references[i] for i in ids]
            srcs = [
                next(u["transcript"] for u in manifest["utterances"] if u["id"] == i)
                for i in ids
            ]
            # chrF++ rather than BLEU: BLEU's word tokenization is a poor fit for
            # Vietnamese, and using one metric per direction would be worse.
            chrf = sacrebleu.corpus_chrf(hyps, [refs], word_order=2).score
            comet_score = comet.predict(
                [{"src": s, "mt": h, "ref": r} for s, h, r in zip(srcs, hyps, refs)],
                batch_size=8,
                gpus=0,
            ).system_score
            report[f"{arm}/{direction}"] = {
                "n": len(ids),
                "chrf++": round(chrf, 2),
                "comet": round(comet_score, 4),
            }

    out_path = rows_path.parent / "adequacy.json"
    out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    print(f"\n→ {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
