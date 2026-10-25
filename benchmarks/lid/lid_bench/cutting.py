"""Cut a recording into the turns production would have sent.

WHEN a turn starts and ends comes from the real SpeechGate, run by
`benchmarks/speaker-id/scripts/gate-reference.mjs` (it transpiles
`packages/realtime-client/src/audio/speech-gate.ts` itself, so there is no
copy of the gate here to drift). WHAT audio a turn carries follows
`capture-pump.ts`, as `benchmarks/speaker-id/speaker_bench/segment.py`
documents it:

- 320 ms of pre-roll, never reaching back past the previous turn's close;
- a hangover-ended turn stops at its last `probableEnd` (held silence dropped);
  a forced cut (the 8 s ceiling) runs to the block before the cut;
- a turn still open when the recording ends is dropped, as production drops it.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from lid_bench.audio import TARGET_RATE, decode, write_wav

REPO_ROOT = Path(__file__).resolve().parents[3]
GATE_REFERENCE = REPO_ROOT / "benchmarks" / "speaker-id" / "scripts" / "gate-reference.mjs"
CACHE = Path(__file__).resolve().parents[1] / ".cache"

#: The browser's capture rate, which the gate is fed at (and downsamples itself).
CAPTURE_RATE = 48000
PRE_ROLL_MS = 320.0
#: The client's turn ceiling; turns longer are force-cut, as in production.
MAX_UTTERANCE_MS = 8000


@dataclass(frozen=True)
class CutTurn:
    index: int
    start_ms: float
    end_ms: float
    reason: str


def gate_events(capture_wav: Path, max_utterance_ms: int = MAX_UTTERANCE_MS) -> dict:
    out = subprocess.run(
        ["node", str(GATE_REFERENCE), str(capture_wav), "--max-utterance-ms", str(max_utterance_ms),
         "--resume-after-cut"],
        capture_output=True, text=True, check=True, cwd=GATE_REFERENCE.parent.parent,
    )
    return json.loads(out.stdout)


def turns_from_events(gate: dict) -> list[CutTurn]:
    block_ms = gate["blockMs"]
    pre_roll_blocks = max(1, round(PRE_ROLL_MS / block_ms))
    turns: list[CutTurn] = []
    open_start = last_probable = None
    prev_end_block = 0
    for event in gate["events"]:
        kind, block = event["type"], event["blockIndex"]
        if kind == "start":
            open_start, last_probable = block, None
        elif kind == "probableEnd" and open_start is not None:
            last_probable = block
        elif kind == "end" and open_start is not None:
            reason = event.get("reason") or "hangover"
            content_end = block - 1 if reason == "forced" else (last_probable if last_probable is not None else block)
            start_block = max(0, prev_end_block, open_start - pre_roll_blocks)
            turns.append(CutTurn(len(turns), start_block * block_ms, (content_end + 1) * block_ms, reason))
            prev_end_block, open_start, last_probable = block, None, None
    return turns


def cut_recording(recording: Path, out_dir: Path, stem: str) -> list[tuple[CutTurn, Path, np.ndarray]]:
    """Cut `recording` (any container) into 16 kHz turn WAVs under `out_dir`."""
    capture = decode(recording, rate=CAPTURE_RATE)
    CACHE.mkdir(exist_ok=True)
    capture_wav = CACHE / f"{stem}.48k.wav"
    write_wav(capture_wav, capture, rate=CAPTURE_RATE)
    try:
        cut = turns_from_events(gate_events(capture_wav))
    finally:
        capture_wav.unlink(missing_ok=True)
    samples = decode(recording, rate=TARGET_RATE)
    out = []
    for turn in cut:
        piece = samples[int(turn.start_ms * TARGET_RATE / 1000): int(turn.end_ms * TARGET_RATE / 1000)]
        path = out_dir / f"{stem}-{turn.index:03d}.wav"
        write_wav(path, piece)
        out.append((turn, path, piece))
    return out
