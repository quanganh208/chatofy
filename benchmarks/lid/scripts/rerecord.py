"""Re-record labelled turns through the laptop's speaker and microphone.

    uv run --frozen python scripts/rerecord.py --per-label 60 [--noise 80]

Public corpora never went through a real room and a real microphone; this
puts them through one, keeping their labels, so the "real" tier has a
far-field laptop channel at no labelling cost. A sample of speech turns from
`data/conversational/` and the ESC-50 noise clips (which become the real-noise
rows A5 needs) are concatenated with 1 s gaps behind a 0.5 s chirp, played
with `pw-play` while `pw-record` captures the default microphone at 48 kHz,
aligned on the chirp by cross-correlation, and cut back at the known offsets.

AUDIBLE: it plays through the speakers for as long as the clips last. The
copies are singletons (no session) under `data/rerecorded/`, channel
`speaker-laptop`, group `rerecorded`, real=True.
"""

from __future__ import annotations

import argparse
import random
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench.audio import TARGET_RATE, decode, read_wav, write_wav  # noqa: E402
from lid_bench.clips import prepare_clip  # noqa: E402
from lid_bench.manifest import Turn, bucket_for, load, opaque_id, save  # noqa: E402
from lid_bench.sidecar import speech_ms  # noqa: E402

DATA = BENCH_ROOT / "data"
OUT = DATA / "rerecorded"
RATE = 48000
GAP_S = 1.0
CHIRP_S = 0.5


def chirp() -> np.ndarray:
    t = np.arange(int(CHIRP_S * RATE)) / RATE
    return (0.5 * np.sin(2 * np.pi * (500 * t + (4000 - 500) / (2 * CHIRP_S) * t**2))).astype(np.float32)


def upsample(samples: np.ndarray) -> np.ndarray:
    """16 kHz -> 48 kHz by linear interpolation; the room is the real filter here."""
    x = np.arange(len(samples) * 3) / 3
    return np.interp(x, np.arange(len(samples)), samples).astype(np.float32)


def microphone() -> str:
    """The first real capture device. Not the default source: on this machine
    that is the speaker's monitor, which would 're-record' the digital signal
    and never touch the room."""
    out = subprocess.run(["pactl", "list", "short", "sources"], capture_output=True, text=True, check=True).stdout
    names = [line.split("\t")[1] for line in out.splitlines() if "\t" in line]
    inputs = [n for n in names if n.startswith("alsa_input.") and not n.endswith(".monitor")]
    if not inputs:
        raise SystemExit(f"no microphone among {names}")
    return inputs[0]


def play_and_record(program: np.ndarray, work: Path) -> np.ndarray:
    play, capture = work / "program.wav", work / "capture.wav"
    write_wav(play, program, rate=RATE)
    recorder = subprocess.Popen(["pw-record", "--target", microphone(), "--rate", str(RATE), "--channels", "1",
                                 "--format", "s16", str(capture)])
    time.sleep(0.5)
    subprocess.run(["pw-play", str(play)], check=True)
    time.sleep(0.5)
    recorder.terminate()
    recorder.wait()
    return decode(capture, rate=RATE)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--per-label", type=int, default=60, help="speech turns per language")
    parser.add_argument("--noise", type=int, default=80)
    args = parser.parse_args()

    rng = random.Random("rerecord")
    conversational = load(DATA / "conversational" / "manifest.jsonl")
    picked = []
    for lang in ("vi", "en", "zh"):
        pool = [t for t in conversational if t.lang == lang]
        picked += rng.sample(pool, min(args.per_label, len(pool)))
    noise = [t for t in load(DATA / "public" / "manifest.jsonl") if t.noise][: args.noise]
    picked += noise

    marker = chirp()
    pieces, offsets = [marker, np.zeros(int(GAP_S * RATE), np.float32)], []
    cursor = sum(len(p) for p in pieces)
    for turn in picked:
        clip = upsample(read_wav(BENCH_ROOT / turn.audio))
        offsets.append((cursor, len(clip)))
        pieces += [clip, np.zeros(int(GAP_S * RATE), np.float32)]
        cursor += len(clip) + int(GAP_S * RATE)
    program = np.concatenate(pieces)
    print(f"playing {len(picked)} clips, {len(program) / RATE / 60:.1f} min")

    work = BENCH_ROOT / ".cache" / "rerecord"
    work.mkdir(parents=True, exist_ok=True)
    captured = play_and_record(program, work)
    search = captured[: int(10 * RATE)]
    lag = find_marker(search, marker)
    peak = float(np.max(np.abs(captured)))
    if peak < 1e-3:
        print("the microphone captured silence; check the input device and volume", file=sys.stderr)
        return 1

    turns: list[Turn] = []
    for turn, (start, length) in zip(picked, offsets):
        segment = captured[lag + start: lag + start + length]
        samples = prepare_clip(decode_16k(segment), speech=not turn.noise)
        turn_id = opaque_id("rerecorded", turn.id)
        path = OUT / f"{turn_id}.wav"
        write_wav(path, samples)
        measured = speech_ms(samples)
        turns.append(Turn(id=turn_id, audio=path.relative_to(BENCH_ROOT).as_posix(), lang=turn.lang,
                          bucket=bucket_for(measured), speech_ms=measured, channel="speaker-laptop",
                          group="rerecorded", source="rerecorded", real=True, license=turn.license,
                          noise=turn.noise, codeswitch=turn.codeswitch, accent_l1=turn.accent_l1))
    save(OUT / "manifest.jsonl", turns)
    print(f"chirp at {lag / RATE:.3f} s, capture peak {peak:.3f}; wrote {len(turns)} turns")
    return 0


def find_marker(signal: np.ndarray, marker: np.ndarray) -> int:
    """Sample offset where `marker` best matches `signal` (FFT cross-correlation)."""
    size = 1 << int(np.ceil(np.log2(len(signal) + len(marker))))
    corr = np.fft.irfft(np.fft.rfft(signal, size) * np.conj(np.fft.rfft(marker, size)), size)
    return int(np.argmax(corr[: len(signal) - len(marker) + 1]))


def decode_16k(samples_48k: np.ndarray) -> np.ndarray:
    """48 kHz capture -> 16 kHz through the same resampler the bench uses."""
    import io

    import soundfile as sf

    buffer = io.BytesIO()
    sf.write(buffer, samples_48k, RATE, format="WAV", subtype="FLOAT")
    return decode(buffer.getvalue(), rate=TARGET_RATE)


if __name__ == "__main__":
    sys.exit(main())
