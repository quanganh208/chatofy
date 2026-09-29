"""Build the real-conversation attribution ruler against the GATED sidecar.

Every window and every noise clip in the output was scored through the exact
sidecar this plan ships: `/embed` for the vector, `/transcribe` with
`min_speech_ms=300` for `sileroMs` and `gatedText`. That is the point of this
script rather than reusing the harness's own numbers — the 300ms floor and the
tau bars it feeds are measured against what the pinned Silero model actually
does on this audio, not against a faster-whisper VAD that never ships.

Two outputs, both gitignored (`benchmarks/speaker-id/.gitignore`):

- `rulers/conversations/ruler.json`: `{cid: [{start,end,truth,speech,vec,
  sileroMs,gatedText}]}`, one row per server turn window in `windows.json`.
  `truth`/`speech` are computed the same way `embwin.py:15-22` computes them —
  the speaker who owns the most overlapping Scribe word-time in the window, or
  `"noise"` if less than 300ms of any speaker's words fall inside it.
- `rulers/conversations/noise-clips.json`: `[{cid,start,end,sileroMs,fraction,
  gatedText}]`, one row per span of 1.5s or more (margined by 0.2s on each
  side) where Scribe has no `type == "word"` entry at all — real non-speech,
  not a short window that merely lacks a Scribe label.

No transcript text is read out of `gatedText` or printed anywhere by this
script: it is written to the ignored ruler files for the test suite to check
`== ""`, and the private evidence rule (see the plan's shared preamble) covers
the rest.

Ports: refuses any `--url` naming port 8012 (the prod sidecar on this host)
unless `--allow-prod` is passed. Default is the dev sidecar, 127.0.0.1:8002.

Run (with the dev sidecar already up on 8002):
    uv run --directory benchmarks/speaker-id python scripts/build_conversation_ruler.py
"""

from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
import uuid
import wave
from collections import Counter
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

import numpy as np

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

REPO_ROOT = BENCH_ROOT.parent.parent
LOCAL_STT_ROOT = REPO_ROOT / "services" / "local-stt"
EVIDENCE_DIR = BENCH_ROOT / "rulers" / "conversations"

SAMPLE_RATE = 16000
GATE_MS = 300
LANGUAGE = "vi"  # every session this ruler covers is vi->en; the source is vi.

#: A span of at least this long with no Scribe word entry at all counts as
#: real non-speech (music, room tone, a trailing piece) rather than a short
#: window that merely fell between two words.
NOISE_MIN_SPAN_S = 1.5

#: Shrunk inward from each side of a qualifying gap before cutting the clip,
#: so Scribe's own word-boundary imprecision cannot bleed a syllable into what
#: is meant to be pure non-speech.
NOISE_MARGIN_S = 0.2


# ── Decoding ─────────────────────────────────────────────────────────────────
# This project has no webm/opus decoder and does not gain one for this script:
# services/local-stt already carries PyAV for exactly this container, so
# decoding runs there, in its own venv, over a subprocess. One full-conversation
# decode per cid, cached in memory; every window and noise clip is a numpy
# slice of the result.

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
    """16kHz mono PCM16 samples for one conversation's webm, decoded once."""
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


def pcm16_slice_to_wav(pcm16: np.ndarray, start_s: float, end_s: float) -> bytes:
    lo = max(0, int(start_s * SAMPLE_RATE))
    hi = min(len(pcm16), int(end_s * SAMPLE_RATE))
    clip = pcm16[lo:hi] if hi > lo else np.zeros(0, dtype="<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(clip.tobytes())
    return buf.getvalue()


# ── Sidecar HTTP ─────────────────────────────────────────────────────────────
# Hand-rolled multipart rather than a `requests` dependency this bench does not
# otherwise carry — the same tradeoff the scratch harness's `embwin.py` made.


def _multipart(fields: dict[str, str], wav_bytes: bytes) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        )
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.wav"\r\n'
        f"Content-Type: audio/wav\r\n\r\n".encode()
        + wav_bytes
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def _post(url: str, fields: dict[str, str], wav_bytes: bytes) -> dict:
    body, content_type = _multipart(fields, wav_bytes)
    req = Request(url, data=body, headers={"Content-Type": content_type})
    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except URLError as err:
        raise RuntimeError(f"POST {url} failed: {err}. Is the dev sidecar running on 8002?") from err


def sidecar_transcribe(base_url: str, wav_bytes: bytes, *, min_speech_ms: int) -> dict:
    return _post(
        f"{base_url}/transcribe",
        {"language": LANGUAGE, "min_speech_ms": str(min_speech_ms)},
        wav_bytes,
    )


def sidecar_embed(base_url: str, wav_bytes: bytes) -> dict:
    return _post(f"{base_url}/embed", {}, wav_bytes)


# ── Truth / speech (embwin.py:15-22) ────────────────────────────────────────


def truth_and_speech(window: dict, words: list[dict]) -> tuple[str, float]:
    counts: Counter[str] = Counter()
    for word in words:
        overlap = min(window["end"], word["end"]) - max(window["start"], word["start"])
        if overlap > 0:
            counts[word["speaker_id"]] += overlap
    total = sum(counts.values())
    truth = counts.most_common(1)[0][0] if total >= 0.3 else "noise"
    return truth, round(total, 2)


def load_words(cid: str) -> tuple[list[dict], float]:
    scribe_path = EVIDENCE_DIR / f"{cid}.scribe.json"
    scribe = json.loads(scribe_path.read_text(encoding="utf-8"))
    words = [w for w in scribe["words"] if w["type"] == "word"]
    return words, float(scribe["audio_duration_secs"])


# ── Ruler builders ───────────────────────────────────────────────────────────


def build_windows_ruler(base_url: str, cid: str, windows: list[dict], words: list[dict], pcm16: np.ndarray) -> list[dict]:
    rows = []
    for window in windows:
        start, end = window["start"], window["end"]
        wav_bytes = pcm16_slice_to_wav(pcm16, start, end)
        truth, speech = truth_and_speech(window, words)
        emb = sidecar_embed(base_url, wav_bytes)
        tr = sidecar_transcribe(base_url, wav_bytes, min_speech_ms=GATE_MS)
        if "speechMs" not in tr:
            raise RuntimeError(
                f"{cid} window [{start},{end}]: /transcribe with min_speech_ms did not "
                "return speechMs — the sidecar under test is not the gated build"
            )
        rows.append(
            {
                "start": round(start, 3),
                "end": round(end, 3),
                "truth": truth,
                "speech": speech,
                "vec": emb.get("vector"),
                "sileroMs": tr["speechMs"],
                "gatedText": tr.get("text", ""),
            }
        )
    return rows


def find_noise_spans(words: list[dict], duration_s: float) -> list[tuple[float, float]]:
    """Spans of >=1.5s with no Scribe word entry, margined 0.2s on each side."""
    spans = sorted((w["start"], w["end"]) for w in words)
    gaps: list[tuple[float, float]] = []
    prev_end = 0.0
    for word_start, word_end in spans:
        if word_start - prev_end >= NOISE_MIN_SPAN_S:
            gaps.append((prev_end, word_start))
        prev_end = max(prev_end, word_end)
    if duration_s - prev_end >= NOISE_MIN_SPAN_S:
        gaps.append((prev_end, duration_s))

    clips = []
    for gap_start, gap_end in gaps:
        clip_start = gap_start + NOISE_MARGIN_S
        clip_end = gap_end - NOISE_MARGIN_S
        if clip_end - clip_start >= NOISE_MIN_SPAN_S - 2 * NOISE_MARGIN_S:
            clips.append((clip_start, clip_end))
    return clips


def build_noise_clips(base_url: str, cid: str, words: list[dict], duration_s: float, pcm16: np.ndarray) -> list[dict]:
    rows = []
    for start, end in find_noise_spans(words, duration_s):
        wav_bytes = pcm16_slice_to_wav(pcm16, start, end)
        tr = sidecar_transcribe(base_url, wav_bytes, min_speech_ms=GATE_MS)
        if "speechMs" not in tr:
            raise RuntimeError(
                f"{cid} noise clip [{start},{end}]: /transcribe with min_speech_ms did not "
                "return speechMs — the sidecar under test is not the gated build"
            )
        silero_ms = tr["speechMs"]
        clip_ms = (end - start) * 1000
        rows.append(
            {
                "cid": cid,
                "start": round(start, 3),
                "end": round(end, 3),
                "sileroMs": silero_ms,
                "fraction": round(silero_ms / clip_ms, 4) if clip_ms > 0 else 0.0,
                "gatedText": tr.get("text", ""),
            }
        )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="http://127.0.0.1:8002", help="sidecar base URL (default: dev, 8002)")
    parser.add_argument(
        "--allow-prod",
        action="store_true",
        help="permit a --url naming port 8012 (the prod sidecar on this host). Never use this for a real run.",
    )
    parser.add_argument("--windows", type=Path, default=EVIDENCE_DIR / "windows.json")
    parser.add_argument("--out-ruler", type=Path, default=EVIDENCE_DIR / "ruler.json")
    parser.add_argument("--out-noise", type=Path, default=EVIDENCE_DIR / "noise-clips.json")
    args = parser.parse_args()

    if "8012" in args.url and not args.allow_prod:
        parser.error(
            "--url names port 8012, the prod sidecar on this host. Pass --allow-prod "
            "only if you mean it; this plan never measures against prod."
        )

    windows_by_cid: dict[str, list[dict]] = json.loads(args.windows.read_text(encoding="utf-8"))

    ruler: dict[str, list[dict]] = {}
    noise_clips: list[dict] = []
    first_call = True

    for cid, windows in windows_by_cid.items():
        print(f"[{cid[:8]}] decoding conversation audio")
        pcm16 = decode_conversation_pcm16(cid)
        words, duration_s = load_words(cid)
        duration_s = min(duration_s, len(pcm16) / SAMPLE_RATE)

        print(f"[{cid[:8]}] {len(windows)} windows")
        rows = build_windows_ruler(args.url, cid, windows, words, pcm16)
        if first_call:
            # The first /transcribe call above already proved speechMs is
            # present (build_windows_ruler raises otherwise); this flag exists
            # only to make that ordering explicit for a reader of the log.
            print(f"[{cid[:8]}] confirmed the gated build (speechMs present)")
            first_call = False
        ruler[cid] = rows

        clips = build_noise_clips(args.url, cid, words, duration_s, pcm16)
        print(f"[{cid[:8]}] {len(clips)} noise clips (>= {NOISE_MIN_SPAN_S}s gap)")
        noise_clips.extend(clips)

    args.out_ruler.parent.mkdir(parents=True, exist_ok=True)
    args.out_ruler.write_text(json.dumps(ruler, indent=0), encoding="utf-8")
    args.out_noise.write_text(json.dumps(noise_clips, indent=0), encoding="utf-8")

    gated = sum(1 for c in noise_clips if c["sileroMs"] < GATE_MS)
    print(
        f"[done] {sum(len(r) for r in ruler.values())} ruler windows, "
        f"{len(noise_clips)} noise clips ({gated} gated, "
        f"{gated / len(noise_clips) * 100 if noise_clips else 0:.1f}%)"
    )
    print(f"wrote {args.out_ruler}")
    print(f"wrote {args.out_noise}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
