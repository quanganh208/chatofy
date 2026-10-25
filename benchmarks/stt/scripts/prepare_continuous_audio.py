"""Join short benchmark clips into continuous speech, for the streaming committer.

    uv run python scripts/prepare_continuous_audio.py --lang zh   # FLEURS cmn, 50 clips
    uv run python scripts/prepare_continuous_audio.py --lang vi   # VIVOS, the clips r6 used

Streaming results only mean something on continuous audio: an isolated 5 s
clip never lets the recognizer's window slide, so it never shows the corrections
a long turn produces. Both languages are built the SAME way — same seed, same
clips per file, same pause between clips — so a zh/vi comparison measures the
language and not the audio's shape. The isolated r6 vi numbers are quoted for
context only.

Each stretch is `--per-file` clips in a seeded order with `--gap-ms` of
silence between them — a pause short enough that the client's speech gate does
not end the turn — then CUT into turns at `--ceiling-s`, the clients' own length
ceiling (`MAX_UTTERANCE_MS = 8000` in web and the extension). That is the shape a
long stretch of speech reaches the server in: turns of the ceiling's length,
split mid-sentence, never longer than the preview's 9 s window. A turn's
reference is the references of the clips it overlaps (joined with no separator
for zh, a space for vi). Writes `data/audio/<name>-continuous/*.wav` and
`data/manifest-<name>-continuous.jsonl`, the shape `commit_probe.py` reads.
VIVOS must be on disk first: `scripts/prepare_datasets.py --langs vi`.
"""
import argparse
import json
import random
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

BENCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH))
from stt_bench.manifest import load_manifest  # noqa: E402

SR = 16_000
SOURCES = {
    "zh": ("manifest-zh-fleurs.jsonl", "zh-fleurs", ""),
    "vi": ("manifest-vi.jsonl", "vi-vivos", " "),
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--lang", choices=sorted(SOURCES), required=True)
    ap.add_argument("--per-file", type=int, default=12, help="clips per continuous file (10-20)")
    ap.add_argument("--gap-ms", type=int, default=400, help="silence between clips")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--ceiling-s", type=float, default=8.0, help="client turn length ceiling")
    a = ap.parse_args()

    manifest_name, name, joiner = SOURCES[a.lang]
    utterances = load_manifest(BENCH / "data" / manifest_name)
    order = list(utterances)
    random.Random(a.seed).shuffle(order)
    groups = [order[i : i + a.per_file] for i in range(0, len(order), a.per_file)]
    # A short tail would be a different audio shape; fold it into the last file.
    if len(groups) > 1 and len(groups[-1]) < a.per_file // 2:
        groups[-2].extend(groups.pop())

    out_dir = BENCH / "data" / "audio" / f"{name}-continuous"
    out_dir.mkdir(parents=True, exist_ok=True)
    gap = np.zeros(int(SR * a.gap_ms / 1000), dtype="float32")
    rows = []
    ceiling = int(SR * a.ceiling_s)
    for index, group in enumerate(groups):
        pieces = []
        spans: list[tuple[int, int, str, str]] = []  # (start, end, id, ref) per clip
        at = 0
        for k, utt in enumerate(group):
            audio, sr = sf.read(utt.audio_path, dtype="float32")
            if sr != SR:
                raise ValueError(f"{utt.id}: need {SR} Hz, got {sr}")
            if k:
                pieces.append(gap)
                at += len(gap)
            pieces.append(audio)
            spans.append((at, at + len(audio), utt.id, utt.ref_text))
            at += len(audio)
        joined = np.concatenate(pieces)
        for turn, start in enumerate(range(0, len(joined), ceiling)):
            piece = joined[start : start + ceiling]
            # A tail shorter than the gate would ever send as a turn is dropped.
            if len(piece) < SR * 3:
                continue
            overlap = [(cid, ref) for s0, s1, cid, ref in spans if s0 < start + len(piece) and s1 > start]
            path = out_dir / f"{name}-continuous-{index:02d}-{turn:02d}.wav"
            sf.write(path, piece, SR, subtype="PCM_16")
            rows.append(
                {
                    "id": path.stem,
                    "lang": a.lang,
                    "audio_path": str(path.relative_to(BENCH / "data")),
                    "ref_text": joiner.join(ref for _cid, ref in overlap),
                    "duration_s": round(len(piece) / SR, 3),
                    "continuous": True,
                    "clips": [cid for cid, _ref in overlap],
                }
            )
    manifest = BENCH / "data" / f"manifest-{name}-continuous.jsonl"
    manifest.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    total = sum(r["duration_s"] for r in rows)
    print(f"{manifest.name}: {len(rows)} turns from {len(groups)} stretches, {total:.0f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
