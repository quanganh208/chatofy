"""Build the audio rulers: what the live recognizer hears, plus the pauses after each word.

The text rulers hand every arm the reference words. These hand it what prod's
recognizer actually produced from the audio, and how long the speaker paused
after each of those words, so an arm can be scored on whether pauses help it
place sentence boundaries.

Runs inside the local-stt sidecar's environment (sherpa-onnx, PyAV, vi model):

    cd services/local-stt && uv run python ../../benchmarks/punct/scripts/build_audio_rulers.py

Options: `--ruler NAME` (repeatable) builds only those; `--limit N` decodes the
first N rows of each and prints them without writing anything, so a smoke run
never overwrites a full rows file; `--probe WAV START END` prints `word[pause]`
for one span of a 16 kHz file.

Rulers written to `benchmarks/punct/data/rows-<ruler>.jsonl`:
  fleurs-audio      FLEURS vi test, first recording per sentence id
  fleurs-audio-dev  FLEURS vi dev, same
  prod-audio        5 recorded sessions, cut at Scribe silences
"""
import argparse
import csv
import io
import json
import re
import sys
import tarfile
import urllib.request
from pathlib import Path

import av
import numpy as np

PUNCT = Path(__file__).resolve().parents[1]
REPO = PUNCT.parents[1]
sys.path[:0] = [str(PUNCT), str(REPO / "services" / "local-stt")]

from engines.word_pauses import pauses_after, word_starts  # noqa: E402
from engines.zipformer_vi import ZipformerVi  # noqa: E402
from punct_bench.text import model_input  # noqa: E402

RATE = 16000
DATA = PUNCT / "data"
EXTERNAL = DATA / "external"
FLEURS_BASE = "https://huggingface.co/datasets/google/fleurs/resolve/main/data/vi_vn"
PROD_DIR = REPO / "benchmarks" / "stt" / "data" / "real-channel-2026-09-29"

#: A Scribe silence at least this long ends a prod chunk.
CHUNK_GAP_S = 1.0
#: A chunk longer than this is split at its largest internal gap...
MAX_CHUNK_S = 30.0
#: ...provided that gap is at least this long.
MIN_SPLIT_GAP_S = 0.4
#: Audio kept on each side of a chunk's first and last word.
PAD_S = 0.15
#: A chunk whose reference has fewer words is dropped.
MIN_REF_WORDS = 4
#: The pause the summary counts as "a real pause".
REAL_PAUSE_MS = 200

TAG = re.compile(r"\[[^\]]*\]")


# --- audio -----------------------------------------------------------------

def decode_audio(source) -> np.ndarray:
    """Any container (path or bytes) to float32 mono at 16 kHz."""
    if isinstance(source, bytes):
        source = io.BytesIO(source)
    chunks = []
    with av.open(source) as container:
        stream = next(s for s in container.streams if s.type == "audio")
        resampler = av.AudioResampler(format="flt", layout="mono", rate=RATE)
        for frame in container.decode(stream):
            chunks += [f.to_ndarray().reshape(-1) for f in resampler.resample(frame)]
        chunks += [f.to_ndarray().reshape(-1) for f in resampler.resample(None)]
    return np.concatenate(chunks).astype(np.float32)


class Hearer:
    """The unbiased offline recognizer prod uses, plus the pause measurement."""

    def __init__(self) -> None:
        engine = ZipformerVi()
        engine.load()
        self.recognizer = engine._recognizer

    def hear(self, samples: np.ndarray) -> tuple[str, list[int]]:
        """(model input, pause ms after each of its words).

        Raises ValueError when the recognizer's word onsets do not line up with
        the words `model_input` keeps.
        """
        stream = self.recognizer.create_stream()
        stream.accept_waveform(RATE, samples)
        self.recognizer.decode_stream(stream)
        res = stream.result
        text = model_input(res.text)
        starts = word_starts(list(res.tokens), list(res.timestamps))
        if len(starts) != len(text.split()):
            raise ValueError(f"{len(starts)} onsets for {len(text.split())} words: {res.text!r}")
        return text, pauses_after(samples, RATE, starts)


def row(ruler: str, row_id: str, text: str, pauses: list[int], ref: str, seconds: float) -> dict:
    return {"ruler": ruler, "id": row_id, "input": text, "ref": ref, "pauses": pauses, "_seconds": seconds}


# --- downloads -------------------------------------------------------------

def fetch(url: str, path: Path) -> Path:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".part")
        print(f"  downloading {url}", flush=True)
        urllib.request.urlretrieve(url, tmp)
        tmp.rename(path)
    return path


# --- FLEURS ----------------------------------------------------------------

def fleurs_sentences(split: str) -> list[tuple[str, str, str]]:
    """(sentence id, wav name, raw transcription): the first recording per id, file order."""
    tsv = fetch(f"{FLEURS_BASE}/{split}.tsv", EXTERNAL / f"fleurs-vi-{split}.tsv")
    seen: dict[str, tuple[str, str, str]] = {}
    with tsv.open(encoding="utf-8") as f:
        for record in csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            seen.setdefault(record[0], (record[0], record[1], record[2]))
    return list(seen.values())


def fleurs_wavs(split: str, names: set[str]) -> Path:
    """Extract only the wavs needed into a per-split directory; skip when all present."""
    out = EXTERNAL / f"fleurs-vi-{split}-wavs"
    if out.is_dir() and names <= {p.name for p in out.iterdir()}:
        return out
    archive = fetch(f"{FLEURS_BASE}/audio/{split}.tar.gz", EXTERNAL / f"fleurs-vi-{split}.tar.gz")
    out.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r|gz") as tar:
        for member in tar:
            name = Path(member.name).name
            if member.isfile() and name in names and not (out / name).exists():
                tmp = out / (name + ".part")
                tmp.write_bytes(tar.extractfile(member).read())
                tmp.rename(out / name)
    missing = names - {p.name for p in out.iterdir()}
    if missing:
        raise RuntimeError(f"{len(missing)} wavs not in {archive.name}, e.g. {sorted(missing)[:3]}")
    return out


def fleurs_rows(hearer: Hearer, ruler: str, split: str, limit: int | None) -> tuple[list[dict], int]:
    sentences = fleurs_sentences(split)[:limit]
    wavs = fleurs_wavs(split, {wav for _, wav, _ in sentences})
    rows, dropped = [], 0
    for sid, wav, ref in sentences:
        samples = decode_audio(str(wavs / wav))
        try:
            text, pauses = hearer.hear(samples)
        except ValueError as err:
            print(f"  drop {ruler}/{sid}: {err}")
            dropped += 1
            continue
        rows.append(row(ruler, sid, text, pauses, ref, len(samples) / RATE))
    return rows, dropped


# --- prod sessions ---------------------------------------------------------

def scribe_chunks(elements: list[dict]) -> list[list[dict]]:
    """The session's words and spacing, cut into chunks at Scribe silences.

    Each chunk is a run of elements starting and ending on a word; audio events
    are dropped. A cut falls where a spacing element, or the gap between two
    consecutive words, lasts at least CHUNK_GAP_S.
    """
    kept = [e for e in elements if e["type"] in ("word", "spacing")]
    chunks: list[list[dict]] = [[]]
    last_word = None
    for e in kept:
        if e["type"] == "spacing":
            if e["end"] - e["start"] >= CHUNK_GAP_S and chunks[-1]:
                chunks.append([])
            elif chunks[-1]:
                chunks[-1].append(e)
            continue
        if last_word is not None and e["start"] - last_word["end"] >= CHUNK_GAP_S and chunks[-1]:
            chunks.append([])
        chunks[-1].append(e)
        last_word = e
    chunks = [_trim(c) for c in chunks]
    return [piece for c in chunks if c for piece in _split_long(c)]


def _trim(chunk: list[dict]) -> list[dict]:
    """Drop leading/trailing spacing so a chunk starts and ends on a word."""
    words = [i for i, e in enumerate(chunk) if e["type"] == "word"]
    return chunk[words[0] : words[-1] + 1] if words else []


def _split_long(chunk: list[dict]) -> list[list[dict]]:
    """Halve a chunk over MAX_CHUNK_S at its largest internal word gap ≥ MIN_SPLIT_GAP_S, repeatedly."""
    if chunk[-1]["end"] - chunk[0]["start"] <= MAX_CHUNK_S:
        return [chunk]
    words = [i for i, e in enumerate(chunk) if e["type"] == "word"]
    gaps = [(chunk[b]["start"] - chunk[a]["end"], a, b) for a, b in zip(words, words[1:])]
    best = max(gaps, default=None)
    if best is None or best[0] < MIN_SPLIT_GAP_S:
        return [chunk]
    _, a, b = best
    return _split_long(chunk[: a + 1]) + _split_long(chunk[b:])


def chunk_ref(chunk: list[dict]) -> str:
    text = TAG.sub(" ", "".join(e["text"] for e in chunk))
    return re.sub(r"\s+", " ", text).strip()


def prod_rows(hearer: Hearer, ruler: str, limit: int | None) -> tuple[list[dict], int]:
    rows, dropped = [], 0
    for webm in sorted(PROD_DIR.glob("*.webm")):
        uuid = webm.stem
        scribe = json.loads((PROD_DIR / f"{uuid}.scribe.json").read_text(encoding="utf-8"))
        audio = decode_audio(str(webm))
        duration = len(audio) / RATE
        for index, chunk in enumerate(scribe_chunks(scribe["words"])):
            if limit is not None and len(rows) >= limit:
                return rows, dropped
            ref = chunk_ref(chunk)
            if len(model_input(ref).split()) < MIN_REF_WORDS:
                continue
            lo = max(chunk[0]["start"] - PAD_S, 0.0)
            hi = min(chunk[-1]["end"] + PAD_S, duration)
            samples = audio[int(lo * RATE) : int(hi * RATE)]
            row_id = f"{uuid[:8]}/{index}"
            try:
                text, pauses = hearer.hear(samples)
            except ValueError as err:
                print(f"  drop {row_id}: {err}")
                dropped += 1
                continue
            rows.append(row(ruler, row_id, text, pauses, ref, len(samples) / RATE))
    return rows, dropped


# --- driver ----------------------------------------------------------------

BUILDERS = {
    "fleurs-audio": lambda h, lim: fleurs_rows(h, "fleurs-audio", "test", lim),
    "fleurs-audio-dev": lambda h, lim: fleurs_rows(h, "fleurs-audio-dev", "dev", lim),
    "prod-audio": lambda h, lim: prod_rows(h, "prod-audio", lim),
}


def inline(r: dict) -> str:
    return " ".join(f"{w}[{p}]" for w, p in zip(r["input"].split(), r["pauses"]))


def summarize(name: str, rows: list[dict], dropped: int) -> None:
    pauses = [p for r in rows for p in r["pauses"]]
    words = len(pauses)
    seconds = sum(r["_seconds"] for r in rows)
    share = sum(p >= REAL_PAUSE_MS for p in pauses) / words if words else 0.0
    print(
        f"{name}: {len(rows)} rows ({dropped} dropped on word/pause mismatch), "
        f"{seconds:.0f}s audio, {words / max(len(rows), 1):.1f} words/row, "
        f"{share:.1%} of words pause >= {REAL_PAUSE_MS}ms",
        flush=True,
    )


def probe(hearer: Hearer, wav: str, start: float, end: float) -> None:
    samples = decode_audio(wav)[int(start * RATE) : int(end * RATE)]
    text, pauses = hearer.hear(samples)
    print(" ".join(f"{w}[{p}]" for w, p in zip(text.split(), pauses)))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--ruler", action="append", choices=sorted(BUILDERS))
    parser.add_argument("--limit", type=int, help="smoke: decode N rows per ruler, print, write nothing")
    parser.add_argument("--probe", nargs=3, metavar=("WAV", "START", "END"))
    args = parser.parse_args()

    hearer = Hearer()
    if args.probe:
        probe(hearer, args.probe[0], float(args.probe[1]), float(args.probe[2]))
        return
    for name in args.ruler or list(BUILDERS):
        rows, dropped = BUILDERS[name](hearer, args.limit)
        for r in rows:
            assert len(r["pauses"]) == len(r["input"].split()), r["id"]
        summarize(name, rows, dropped)
        if args.limit is not None:
            for r in rows:
                print(f"  {r['id']}: {inline(r)}\n    ref: {r['ref']}")
            continue
        out = DATA / f"rows-{name}.jsonl"
        with out.open("w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps({k: v for k, v in r.items() if k != "_seconds"}, ensure_ascii=False) + "\n")
        print(f"  wrote {out.relative_to(REPO)}")


if __name__ == "__main__":
    main()
