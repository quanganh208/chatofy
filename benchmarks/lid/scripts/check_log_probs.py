"""Does each sidecar engine fill `ys_log_probs`? Answer before anything else.

Arm 4's strongest feature is the recognizer's own confidence in its tokens. If an
engine leaves the list empty (Paraformer is non-autoregressive and might), arm 4
has to fall back to text features for that language, and that changes what the
arm is. So this runs first and its table goes into the README.

Decodes a few clips per language on EVERY engine — the mismatched decodes are
the interesting ones, since that is what a competition between recognizers
looks like — and prints, per (engine, clip language): how many decodes had a
log-prob per token, and the mean log-prob.

    uv run python scripts/check_log_probs.py [--per-lang 5]
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import soundfile as sf

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench.manifest import LANGUAGES, load  # noqa: E402
from lid_bench.sidecar import SidecarEngines  # noqa: E402

DEFAULT_MANIFEST = BENCH_ROOT / "data" / "public" / "manifest.jsonl"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--per-lang", type=int, default=5)
    args = parser.parse_args()

    if not args.manifest.exists():
        print(f"no manifest at {args.manifest}; run scripts/prepare_public.py first", file=sys.stderr)
        return 1
    turns = load(args.manifest)
    clips = {
        lang: [t for t in turns if t.lang == lang and t.bucket != "<1.5"][: args.per_lang]
        for lang in LANGUAGES
    }
    missing = [lang for lang, picked in clips.items() if len(picked) < args.per_lang]
    if missing:
        print(f"fewer than {args.per_lang} clips for {missing}", file=sys.stderr)
        return 1

    engines = SidecarEngines()
    stats: dict[tuple[str, str], list[tuple[bool, float]]] = defaultdict(list)
    for clip_lang, picked in clips.items():
        for turn in picked:
            samples, rate = sf.read(BENCH_ROOT / turn.audio, dtype="float32")
            assert rate == 16000
            for engine_lang in engines.languages:
                decode = engines.decode(engine_lang, samples)
                filled = len(decode.log_probs) == len(decode.tokens) and len(decode.tokens) > 0
                mean = float(np.mean(decode.log_probs)) if decode.log_probs else float("nan")
                stats[(engine_lang, clip_lang)].append((filled, mean))

    print("| engine | clip lang | filled / decodes | mean log-prob |")
    print("|---|---|---|---|")
    empty_engines = []
    for engine_lang in engines.languages:
        any_filled = False
        for clip_lang in LANGUAGES:
            rows = stats[(engine_lang, clip_lang)]
            filled = sum(1 for ok, _ in rows if ok)
            any_filled |= filled > 0
            means = [m for ok, m in rows if ok]
            mean = f"{np.mean(means):.3f}" if means else "—"
            print(f"| {engine_lang} | {clip_lang} | {filled} / {len(rows)} | {mean} |")
        if not any_filled:
            empty_engines.append(engine_lang)
    if empty_engines:
        print(f"\nys_log_probs EMPTY for {empty_engines}: arm 4 uses text features for them")
    return 0


if __name__ == "__main__":
    sys.exit(main())
