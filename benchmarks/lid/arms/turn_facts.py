"""Arm-independent facts about every turn, measured once per run.

- `silero_ms`: Silero speech, the measure the API's speech floor
  (`STT_MIN_SPEECH_MS`) is applied to. A5 asks first whether this floor already
  drops noise turns before any language decision is made.
- `embedding`: the CAM++ vector the sidecar's `/embed` returns, for turns that
  belong to a session. The voice prior and the "second voice lifts the source
  prior" rule group turns by the client's speaker labels, which are simulated
  from these (lid_bench.prior.ClientVoiceLabels).

Both through the sidecar's own classes, so the numbers are the sidecar's.

    uv run python arms/turn_facts.py --manifest M --out DIR
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench.audio import read_wav  # noqa: E402
from lid_bench.manifest import load  # noqa: E402
from lid_bench.sidecar import _import_sidecar  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    _import_sidecar()
    from audio.silero_speech import SileroSpeechGate
    from engines.base import preload_onnxruntime_dll
    from speaker.embedder import SpeakerEmbedder

    preload_onnxruntime_dll()
    gate = SileroSpeechGate()
    gate.load()
    turns = load(args.manifest)
    embedder = None
    if any(t.session is not None for t in turns):
        embedder = SpeakerEmbedder()
        embedder.load()

    args.out.mkdir(parents=True, exist_ok=True)
    with (args.out / "facts.jsonl").open("w", encoding="utf-8") as fh:
        for turn in turns:
            samples = read_wav(BENCH_ROOT / turn.audio)
            row = {"id": turn.id, "silero_ms": gate.speech_ms(samples)}
            if embedder is not None and turn.session is not None and not turn.noise:
                row["embedding"] = [round(v, 6) for v in embedder.embed(samples)]
            fh.write(json.dumps(row) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
