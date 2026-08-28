"""Write what the shipping recognizer produces for the display-fidelity set.

Step 1 of 3 in measuring the display repair. It exists because the repair runs in
TypeScript — it has to go through the real `GeminiTranslationProvider.repair()`,
not a re-declaration of the prompt — while the scoring instrument is this
project's Python `display_fidelity`. So the recognizer's output is written down
once and both halves read it:

    uv run python scripts/dump_display_hypotheses.py      # this file
    node scripts/repair_display_hypotheses.mjs            # the real provider
    uv run python scripts/score_display_repair.py         # vs the recorded zero

Transcription is deterministic given the audio (greedy decoding, fixed model), so
dumping once and reusing it costs nothing and keeps the repair run comparable
across re-runs.

The audio is one speaker's own voice recorded through the real browser capture
chain: personal data, gitignored, and not independently reproducible. The output
of this script is a transcript OF that audio and is gitignored for the same
reason.
"""

import json
import sys
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from stt_bench.engines import create_engine  # noqa: E402
from stt_bench.manifest import load_manifest  # noqa: E402

MANIFEST = BENCH_ROOT / "data" / "manifest-vi-display.jsonl"
OUT = BENCH_ROOT / "data" / "display-hypotheses.jsonl"


def shipping_postprocess(text: str) -> str:
    """Verbatim from services/local-stt/engines/zipformer_vi.py::postprocess.

    Copied rather than imported, exactly as `run_display_baseline.py` does: the
    sidecar is a separate uv project, and this is the whole of what turns the
    decoder's output into what the user reads. The repair receives THIS string,
    because it is what the socket carries.
    """
    text = text.strip().lower()
    return text[:1].upper() + text[1:]


def main() -> int:
    utterances = load_manifest(MANIFEST)
    nouns = {
        r["id"]: r.get("proper_nouns", [])
        for r in (
            json.loads(line)
            for line in MANIFEST.read_text(encoding="utf-8").splitlines()
            if line.strip()
        )
    }

    engine = create_engine("sherpa-zipformer-vi")  # shipping config: greedy, unbiased
    engine.load()

    with OUT.open("w", encoding="utf-8") as handle:
        for utt in utterances:
            handle.write(
                json.dumps(
                    {
                        "id": utt.id,
                        "raw": shipping_postprocess(engine.transcribe(utt.audio_path)),
                        "ref_text": utt.ref_text,
                        "proper_nouns": nouns[utt.id],
                        "language": "vi",
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )

    print(f"{len(utterances)} hypotheses → {OUT.relative_to(BENCH_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
