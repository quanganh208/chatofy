"""Emit the VIVOS comparability arm from the STT harness's manifest.

Reads `benchmarks/stt/data/manifest-vi.jsonl` and never writes to it.

Two things this script decides, both of which the report has to state:

**Casing.** VIVOS references are ALL CAPS. ZeroTTS processes raw orthography
with no grapheme-to-phoneme stage, so casing can reach the model — feeding it
shouted text would measure something no caller produces. So `text` is
sentence-cased for synthesis while `ref_text` keeps the corpus's original caps,
and the scorer's normalizer (which lowercases both sides) reconciles them.

**Why this arm is secondary.** ZeroBench-TTS redistributes VIVOS, so ZeroTTS may
have seen this material. It is here for comparability with the existing STT
numbers, which were measured on these exact 50 utterances; the conversational
arm is the one the verdict rests on.
"""

import json
import sys
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
SOURCE = BENCH_ROOT.parent / "stt" / "data" / "manifest-vi.jsonl"
OUT = BENCH_ROOT / "data" / "sentences-vivos.jsonl"

HEADER = """\
# VIVOS — the comparability arm. Built by scripts/build_vivos_set.py; do not edit.
#
# Source: benchmarks/stt/data/manifest-vi.jsonl (read-only), the same 50
# utterances the STT harness measured, which is what makes the human-speech
# control floors in docs/development-journey.md apply here.
#
# CASING: `ref_text` keeps the corpus's ALL CAPS; `text` is sentence-cased for
# synthesis, because ZeroTTS reads raw orthography with no G2P stage and no
# caller ever sends shouted text. The scorer's normalizer lowercases both sides.
#
# CAVEAT: ZeroBench-TTS redistributes VIVOS, so ZeroTTS may have seen this
# material. Secondary to the conversational arm for exactly that reason.
"""


def sentence_case(text: str) -> str:
    """ALL CAPS -> sentence case, leaving Vietnamese diacritics untouched.

    `str.capitalize()` would be wrong: it lowercases the rest of the string but
    also strips any legitimate internal capital. These references carry no
    proper-noun casing to preserve (they are uniformly upper), so lowering the
    tail and raising the first character is exact here.
    """
    text = text.strip().lower()
    return text[:1].upper() + text[1:] if text else text


def main() -> int:
    if not SOURCE.exists():
        print(f"[error] missing source manifest {SOURCE}", file=sys.stderr)
        return 1

    rows = []
    for line in SOURCE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        src = json.loads(line)
        ref = src["ref_text"].strip()
        rows.append(
            {
                # Prefixed so it cannot collide with a conversational id inside
                # the shared results tree.
                "id": f"vivos-{src['id']}",
                "text": sentence_case(ref),
                "ref_text": ref,
                "tags": ["vivos"],
            }
        )

    OUT.write_text(
        HEADER + "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n",
        encoding="utf-8",
    )
    print(f"[done] {len(rows)} rows -> {OUT.relative_to(BENCH_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
