"""Sweep `SPLIT_COSINE` against real saved turns from the five conversations.

`apps/api/src/modules/translate/session/speaker-change-split.ts` decides,
inside one captured turn's own audio, whether an internal pause of at least
300ms separates two voices — and if so, cuts there. `SPLIT_COSINE` is the
cosine below which the piece after a pause is judged a different voice from
the run before it. It used to sit between the clusterer's `tauNew` and
`tauAssign`; phase 06 raised those bars past it, so this sweeps 0.35/0.40/0.45
fresh, against the same five real recordings the attribution rulers use.

**Piece boundaries come from the real transpiled planner.** `split-reference.mjs
--pieces` runs `findInternalPauses`/`piecesBetween` from the shipped TypeScript
over one saved turn's real audio, so a wrong boundary here is a wrong boundary
in production too, not a guess this script invented.

**The grouping rule is ported into Python, and the port is checked, not
trusted.** `SPLIT_COSINE` is module-private (no CLI knob reaches it), so
`split-reference.mjs --group` can only run the real `groupByVoice` at the
shipped 0.35. This script re-implements the same duration-weighted running-
centroid rule in `_group_by_voice`, parametrised by threshold, and — before
scoring anything — compares its own 0.35 output against the real script's on
every turn. A mismatch aborts the whole run: a wrong port would silently
misrepresent every other threshold it prints.

**What is counted, and what is not.** For each pause boundary between two
judged pieces, the ground truth is the dominant Scribe speaker on each side
(by overlapping word-time, the same rule `build_conversation_ruler.py` uses
for the attribution ruler). A boundary where either side has under 0.3s of
overlapping speech is ambiguous and excluded from both counts, exactly as the
ruler excludes it from `truth`. What remains:

- **wrong cut**: the grouping rule cut here, but both sides are the same
  Scribe speaker.
- **missed change**: the grouping rule did not cut here, but the two sides are
  different Scribe speakers.

Counts only — no transcript text is read out of `scribe.json` or printed.

Ports: refuses `--url` naming 8012 (the prod sidecar on this host) unless
`--allow-prod` is passed. Default is the dev sidecar, 127.0.0.1:8002.

Run (with the dev sidecar already up on 8002):
    uv run python scripts/split_cosine_sweep.py
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import subprocess
import sys
import tempfile
import uuid
import wave
from collections import Counter
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

import numpy as np

BENCH_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BENCH_ROOT.parent.parent
LOCAL_STT_ROOT = REPO_ROOT / "services" / "local-stt"
EVIDENCE_DIR = BENCH_ROOT / "rulers" / "conversations"
SPLIT_REFERENCE = BENCH_ROOT / "scripts" / "split-reference.mjs"

SAMPLE_RATE = 16000

#: `speaker-change-split.ts`'s own fixed floors — not swept, ported here only
#: to size pieces and skip candidates the shipped code would also skip.
MIN_PIECE_MS = 500
MAX_PIECES = 12

#: `truth_and_speech`'s own bar (`build_conversation_ruler.py`): under 0.3s of
#: overlapping Scribe word-time, a piece's dominant speaker is not trusted.
MIN_OVERLAP_S = 0.3

#: The sessions with more than one real Scribe speaker, i.e. where a missed
#: change is even possible. `5b679761`/`74410b70` have three voices and are
#: excluded from clusterer tuning elsewhere in this plan, but a wrong cut or a
#: missed change is still a real, countable event on their audio.
MULTI_SPEAKER_SESSIONS = (
    "2499c493-7609-42e5-b21e-fa82ae1b4b9f",
    "5b679761-e8fb-4ddf-832b-dca95f37ee21",
    "74410b70-8a01-47be-a199-4ca6e15e98ae",
)
#: Single real speaker throughout. The decision rule (phase 06, step 5) allows
#: a candidate threshold only if it adds no wrong cut here.
SINGLE_SPEAKER_SESSIONS = (
    "2bed5c89-6ef4-4ee6-a559-79f3db4c3e2c",
    "1cd04a39-17d7-40cc-acb1-4db591fc6777",
)

THRESHOLDS = (0.35, 0.40, 0.45)


# ── Decoding (same subprocess arrangement as build_conversation_ruler.py) ────

_DECODE_SCRIPT = """
import sys
sys.path.insert(0, sys.argv[1])
from audio.decode import decode_to_16k_mono
import numpy as np
with open(sys.argv[2], "rb") as f:
    data = f.read()
samples = decode_to_16k_mono(data)
pcm = np.clip(samples, -1.0, 1.0)
pcm16 = (pcm * 32767.0).astype("<i2")
sys.stdout.buffer.write(pcm16.tobytes())
"""


def decode_conversation_pcm16(cid: str) -> np.ndarray:
    webm_path = EVIDENCE_DIR / f"{cid}.webm"
    if not webm_path.exists():
        raise FileNotFoundError(webm_path)
    result = subprocess.run(
        ["uv", "run", "python", "-c", _DECODE_SCRIPT, str(LOCAL_STT_ROOT), str(webm_path)],
        cwd=LOCAL_STT_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        raise RuntimeError(f"decoding {webm_path} failed: {result.stderr.decode(errors='replace')}")
    return np.frombuffer(result.stdout, dtype="<i2")


def load_turn_bounds(cid: str, duration_s: float) -> list[tuple[float, float]]:
    """One saved turn per row of `<cid>.turns.tsv`: (start_s, end_s).

    Column 1 is each saved turn's own start offset in ms (`windows.py` uses
    the same column the same way to align server events). A turn's audio is
    taken to run until the next turn's start — including whatever trailing
    hangover the server captured before the next turn began, which is exactly
    the shape `speaker-change-split.ts` receives in production (its own
    trailing-edge pause is never returned by `findInternalPauses` as internal).
    """
    rows = list(csv.reader(open(EVIDENCE_DIR / f"{cid}.turns.tsv", encoding="utf-8"), delimiter="\t"))
    starts = [int(row[1]) / 1000 for row in rows]
    bounds = []
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else duration_s
        if end > start:
            bounds.append((start, end))
    return bounds


def load_words(cid: str) -> list[dict]:
    scribe = json.loads((EVIDENCE_DIR / f"{cid}.scribe.json").read_text(encoding="utf-8"))
    return [w for w in scribe["words"] if w["type"] == "word"]


def dominant_speaker(words: list[dict], start_s: float, end_s: float) -> str | None:
    """The Scribe speaker with the most overlapping word-time in [start_s, end_s),
    or `None` if under `MIN_OVERLAP_S` total — ambiguous, not a truth value.
    """
    counts: Counter[str] = Counter()
    for word in words:
        overlap = min(end_s, word["end"]) - max(start_s, word["start"])
        if overlap > 0:
            counts[word["speaker_id"]] += overlap
    total = sum(counts.values())
    if total < MIN_OVERLAP_S:
        return None
    return counts.most_common(1)[0][0]


# ── The real transpiled planner ──────────────────────────────────────────────


def pieces_for_turn(pcm16: np.ndarray, start_s: float, end_s: float) -> tuple[list[dict], list[dict]]:
    lo = max(0, int(start_s * SAMPLE_RATE))
    hi = min(len(pcm16), int(end_s * SAMPLE_RATE))
    clip = pcm16[lo:hi] if hi > lo else np.zeros(0, dtype="<i2")
    with tempfile.NamedTemporaryFile(suffix=".pcm", delete=False) as handle:
        handle.write(clip.tobytes())
        pcm_path = handle.name
    try:
        result = subprocess.run(
            ["node", str(SPLIT_REFERENCE), "--pieces", pcm_path, str(SAMPLE_RATE)],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
        )
    finally:
        Path(pcm_path).unlink(missing_ok=True)
    if result.returncode != 0:
        raise RuntimeError(f"split-reference.mjs --pieces failed: {result.stderr.strip()[:500]}")
    out = json.loads(result.stdout)
    return out["pauses"], out["pieces"]


def group_by_voice_reference(judged_pieces: list[dict]) -> list[list[int]]:
    """The real `groupByVoice`, at the shipped `SPLIT_COSINE` (0.35) — the
    oracle `_group_by_voice`'s own 0.35 output is checked against below.
    """
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
        json.dump({"pieces": judged_pieces}, handle)
        input_path = handle.name
    try:
        result = subprocess.run(
            ["node", str(SPLIT_REFERENCE), "--group", input_path],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
        )
    finally:
        Path(input_path).unlink(missing_ok=True)
    if result.returncode != 0:
        raise RuntimeError(f"split-reference.mjs --group failed: {result.stderr.strip()[:500]}")
    return json.loads(result.stdout)["runs"]


def _cosine(a: list[float], b: list[float]) -> float:
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    if na == 0 or nb == 0:
        return 1.0
    return sum(x * y for x, y in zip(a, b)) / (na * nb)


def _group_by_voice(judged_pieces: list[dict], threshold: float) -> list[list[int]]:
    """Port of `groupByVoice` (`speaker-change-split.ts:155-180`), threshold
    parametrised. A duration-weighted running centroid per run; a new run
    starts when the next judged piece scores below `threshold` against it.
    """
    runs: list[list[int]] = []
    first = 0
    voice: list[float] | None = None

    def fold(piece: dict) -> None:
        nonlocal voice
        vector = piece.get("vector")
        if vector is None:
            return
        weight = piece["endMs"] - piece["startMs"]
        if voice is None:
            voice = [0.0] * len(vector)
        for i, value in enumerate(vector):
            voice[i] += value * weight

    fold(judged_pieces[0])
    for k in range(1, len(judged_pieces)):
        piece = judged_pieces[k]
        vector = piece.get("vector")
        if voice is not None and vector is not None and _cosine(voice, vector) < threshold:
            runs.append([first, k - 1])
            first = k
            voice = None
        fold(piece)
    runs.append([first, len(judged_pieces) - 1])
    return runs


# ── Sidecar /embed ────────────────────────────────────────────────────────────


def _multipart(wav_bytes: bytes) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.wav"\r\n'
        f"Content-Type: audio/wav\r\n\r\n".encode()
        + wav_bytes
        + f"\r\n--{boundary}--\r\n".encode()
    )
    return body, f"multipart/form-data; boundary={boundary}"


def sidecar_embed(base_url: str, pcm16: np.ndarray, start_s: float, end_s: float) -> list[float] | None:
    lo = max(0, int(start_s * SAMPLE_RATE))
    hi = min(len(pcm16), int(end_s * SAMPLE_RATE))
    clip = pcm16[lo:hi] if hi > lo else np.zeros(0, dtype="<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(clip.tobytes())
    body, content_type = _multipart(buf.getvalue())
    req = Request(f"{base_url}/embed", data=body, headers={"Content-Type": content_type})
    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read()).get("vector")
    except URLError as err:
        raise RuntimeError(f"POST {base_url}/embed failed: {err}. Is the dev sidecar up on 8002?") from err


# ── Sweep ─────────────────────────────────────────────────────────────────────


def sweep_conversation(base_url: str, cid: str) -> dict[float, dict[str, int]]:
    pcm16 = decode_conversation_pcm16(cid)
    duration_s = len(pcm16) / SAMPLE_RATE
    words = load_words(cid)
    turns = load_turn_bounds(cid, duration_s)

    counts = {t: {"wrong_cuts": 0, "missed_changes": 0, "candidates": 0} for t in THRESHOLDS}

    for turn_start, turn_end in turns:
        pauses, pieces = pieces_for_turn(pcm16, turn_start, turn_end)
        if len(pauses) == 0 or len(pieces) > MAX_PIECES:
            continue
        judgeable = [p for p in pieces if p["endMs"] - p["startMs"] >= MIN_PIECE_MS]
        if len(judgeable) < 2:
            continue

        judged_pieces = []
        for piece in pieces:
            judged = dict(piece)
            if piece["endMs"] - piece["startMs"] >= MIN_PIECE_MS:
                judged["vector"] = sidecar_embed(
                    base_url, pcm16, turn_start + piece["startMs"] / 1000, turn_start + piece["endMs"] / 1000
                )
            else:
                judged["vector"] = None
            judged_pieces.append(judged)

        reference_runs = group_by_voice_reference(judged_pieces)
        oracle_runs_035 = _group_by_voice(judged_pieces, 0.35)
        if oracle_runs_035 != reference_runs:
            raise RuntimeError(
                f"{cid[:8]}: Python port of groupByVoice disagrees with split-reference.mjs "
                f"at 0.35 -- {oracle_runs_035} vs {reference_runs}. Aborting the sweep; "
                "the port is wrong, not the grouping rule."
            )

        # Ground truth per piece, absolute conversation time.
        truths = [
            dominant_speaker(words, turn_start + p["startMs"] / 1000, turn_start + p["endMs"] / 1000)
            for p in pieces
        ]

        for threshold in THRESHOLDS:
            runs = reference_runs if threshold == 0.35 else _group_by_voice(judged_pieces, threshold)
            cut_after = [False] * (len(pieces) - 1)
            for first, last in runs:
                if last < len(pieces) - 1:
                    cut_after[last] = True

            for boundary in range(len(pieces) - 1):
                left, right = truths[boundary], truths[boundary + 1]
                if left is None or right is None:
                    continue
                counts[threshold]["candidates"] += 1
                cut = cut_after[boundary]
                if cut and left == right:
                    counts[threshold]["wrong_cuts"] += 1
                elif not cut and left != right:
                    counts[threshold]["missed_changes"] += 1

    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="http://127.0.0.1:8002", help="sidecar base URL (default: dev, 8002)")
    parser.add_argument(
        "--allow-prod",
        action="store_true",
        help="permit a --url naming port 8012 (the prod sidecar on this host). Never use this for a real run.",
    )
    args = parser.parse_args()

    if "8012" in args.url and not args.allow_prod:
        parser.error(
            "--url names port 8012, the prod sidecar on this host. Pass --allow-prod "
            "only if you mean it; this plan never measures against prod."
        )

    all_cids = MULTI_SPEAKER_SESSIONS + SINGLE_SPEAKER_SESSIONS
    per_session: dict[str, dict[float, dict[str, int]]] = {}
    for cid in all_cids:
        print(f"[{cid[:8]}] sweeping", file=sys.stderr)
        per_session[cid] = sweep_conversation(args.url, cid)

    print(f"{'session':10s} {'threshold':>9s} {'wrong cuts':>10s} {'missed changes':>14s} {'candidates':>10s}")
    totals = {t: {"wrong_cuts": 0, "missed_changes": 0} for t in THRESHOLDS}
    for cid in MULTI_SPEAKER_SESSIONS:
        for threshold in THRESHOLDS:
            row = per_session[cid][threshold]
            print(
                f"{cid[:8]:10s} {threshold:9.2f} {row['wrong_cuts']:10d} {row['missed_changes']:14d} "
                f"{row['candidates']:10d}"
            )
            totals[threshold]["wrong_cuts"] += row["wrong_cuts"]
            totals[threshold]["missed_changes"] += row["missed_changes"]
    print("--- multi-speaker sessions, summed ---")
    for threshold in THRESHOLDS:
        total = totals[threshold]["wrong_cuts"] + totals[threshold]["missed_changes"]
        print(
            f"{'sum':10s} {threshold:9.2f} {totals[threshold]['wrong_cuts']:10d} "
            f"{totals[threshold]['missed_changes']:14d} {'':>10s}  (wrong+missed={total})"
        )

    print("--- single-voice sessions: wrong cuts must be 0 to qualify ---")
    for cid in SINGLE_SPEAKER_SESSIONS:
        for threshold in THRESHOLDS:
            row = per_session[cid][threshold]
            print(
                f"{cid[:8]:10s} {threshold:9.2f} {row['wrong_cuts']:10d} {row['missed_changes']:14d} "
                f"{row['candidates']:10d}"
            )

    return 0


if __name__ == "__main__":
    sys.exit(main())
