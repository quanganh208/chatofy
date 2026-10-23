"""Public rulers: FLEURS, Common Voice, L2-ARCTIC, ESC-50 -> data/public/.

    uv run python scripts/prepare_public.py [--sources fleurs,esc50,cv,l2arctic]

Every clip becomes a 16 kHz mono PCM16 WAV and one manifest row in
`data/public/manifest.jsonl`. A run replaces the rows of the sources it was
asked for and keeps the rest, so sources can be added one at a time.

- FLEURS `vi_vn`, `en_us`, `cmn_hans_cn` test (google/fleurs, CC-BY-4.0):
  fetched automatically. Read speech; clips longer than the client's 8 s turn
  ceiling are cut at 8 s, which is what the client would have done to them.
- ESC-50 (CC BY-NC 3.0, fetched from GitHub): environmental sounds, cut to a
  random 0.5-3 s window -- the length of a cough or a door that opens a turn.
- Common Voice vi / en / zh-CN and L2-ARCTIC need a terms acceptance this
  script will not make on the maintainer's behalf. Download them by hand into
  the directories printed when they are missing; the script stops with that
  instruction rather than skipping them silently.

Licences of the NC sources are fine for a non-commercial thesis; none of the
audio is redistributed (data/ is gitignored).
"""

from __future__ import annotations

import argparse
import csv
import io
import random
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench.audio import TARGET_RATE, decode, write_wav  # noqa: E402
from lid_bench.clips import prepare_clip  # noqa: E402
from lid_bench.manifest import Turn, bucket_for, load, opaque_id, save  # noqa: E402
from lid_bench.sidecar import speech_ms  # noqa: E402

DATA = BENCH_ROOT / "data"
OUT = DATA / "public"
DOWNLOADS = DATA / "downloads"

FLEURS = {"vi": "vi_vn", "en": "en_us", "zh": "cmn_hans_cn"}
#: Per language. zh is larger: with no conversational zh, FLEURS is most of
#: what A1's zh pairs are measured on, and the plan asks for >=400 public zh.
FLEURS_COUNT = {"vi": 300, "en": 300, "zh": 500}
ESC50_URL = "https://github.com/karolpiczak/ESC-50/archive/master.zip"
ESC50_COUNT = 80
CV_LOCALES = {"vi": "vi", "en": "en", "zh": "zh-CN"}
CV_COUNT = 200
L2ARCTIC_SPEAKERS = {"vi": ("HQTV", "PNV", "THV", "TLV"), "zh": ("BWC", "LXC", "NCC", "TXHC")}
L2ARCTIC_PER_SPEAKER = {"vi": 75, "zh": 40}


def download(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"[download] {url}")
    part = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url, timeout=120) as response, part.open("wb") as out:
        shutil.copyfileobj(response, out, length=1 << 20)
    part.rename(dest)
    return dest


def make_turn(samples: np.ndarray, *, key: str, lang: str, source: str, group: str,
              license: str, accent_l1: str | None = None, channel: str = "read") -> Turn:
    samples = prepare_clip(samples, speech=lang != "noise")
    turn_id = opaque_id(source, key)
    path = OUT / source / f"{turn_id}.wav"
    write_wav(path, samples)
    measured = speech_ms(samples)
    return Turn(
        id=turn_id, audio=path.relative_to(BENCH_ROOT).as_posix(), lang=lang,
        bucket=bucket_for(measured), speech_ms=measured, channel=channel, group=group,
        source=source, real=False, license=license, noise=lang == "noise", accent_l1=accent_l1,
    )


def fleurs() -> list[Turn]:
    import pyarrow.parquet as pq

    turns = []
    for lang, config in FLEURS.items():
        url = f"https://huggingface.co/api/datasets/google/fleurs/parquet/{config}/test/0.parquet"
        table = pq.read_table(download(url, DOWNLOADS / "fleurs" / f"{config}-test-0.parquet"),
                              columns=["id", "audio"]).to_pylist()
        rows = sorted(table, key=lambda r: Path(r["audio"]["path"]).stem)
        picked = random.Random(f"fleurs-{lang}").sample(rows, min(FLEURS_COUNT[lang], len(rows)))
        for row in picked:
            samples = decode(row["audio"]["bytes"])
            if not samples.any():
                raise RuntimeError(f"fleurs {lang} {row['id']}: decoded to silence")
            turns.append(make_turn(samples, key=Path(row["audio"]["path"]).stem, lang=lang,
                                   source="fleurs", group="fleurs", license="CC-BY-4.0"))
        print(f"fleurs {lang}: {len(picked)}")
    return turns


def esc50() -> list[Turn]:
    archive = download(ESC50_URL, DOWNLOADS / "esc50" / "ESC-50-master.zip")
    rng = random.Random("esc50")
    with zipfile.ZipFile(archive) as zf:
        names = sorted(n for n in zf.namelist() if n.endswith(".wav") and "/audio/" in n)
        turns = []
        for name in rng.sample(names, ESC50_COUNT):
            samples = decode(zf.read(name))
            length = rng.uniform(0.5, 3.0)
            # The loudest window, not a random one: ESC-50 clips are often
            # mostly silence around one event, and a silent window tests nothing.
            window = int(length * TARGET_RATE)
            energy = np.convolve(samples**2, np.ones(window), mode="valid")
            start = int(np.argmax(energy)) if energy.size else 0
            turns.append(make_turn(samples[start:start + window], key=Path(name).stem, lang="noise",
                                   source="esc50", group="esc50", license="CC-BY-NC-3.0"))
    print(f"esc50: {len(turns)}")
    return turns


def common_voice() -> list[Turn]:
    turns = []
    for lang, locale in CV_LOCALES.items():
        root = DOWNLOADS / "cv" / locale
        tsv = root / "test.tsv"
        if not tsv.exists():
            raise MissingSource(
                f"Common Voice {locale}: accept the dataset terms, download the {locale} "
                f"release and extract it so that {tsv} and {root / 'clips'}/ exist."
            )
        with tsv.open(encoding="utf-8") as fh:
            rows = sorted(csv.DictReader(fh, delimiter="\t"), key=lambda r: r["path"])
        rng = random.Random(f"cv-{lang}")
        rng.shuffle(rows)
        # Short clips first: CV is where the <1.5 s bucket gets its public rows.
        decoded = []
        for row in rows[: CV_COUNT * 4]:
            samples = decode(root / "clips" / row["path"])
            decoded.append((len(samples), row["path"], samples))
        decoded.sort(key=lambda item: item[0])
        for _, name, samples in decoded[:CV_COUNT]:
            turns.append(make_turn(samples, key=name, lang=lang, source="cv", group="cv",
                                   license="CC0-1.0"))
        print(f"cv {lang}: {min(CV_COUNT, len(decoded))}")
    return turns


def l2arctic() -> list[Turn]:
    turns = []
    for l1, speakers in L2ARCTIC_SPEAKERS.items():
        for speaker in speakers:
            wav_dir = DOWNLOADS / "l2arctic" / speaker / "wav"
            if not wav_dir.is_dir():
                raise MissingSource(
                    f"L2-ARCTIC {speaker}: request the corpus (CC BY-NC 4.0) and extract "
                    f"it so that {wav_dir}/ holds that speaker's WAVs."
                )
            names = sorted(wav_dir.glob("*.wav"))
            for path in random.Random(f"l2arctic-{speaker}").sample(names, L2ARCTIC_PER_SPEAKER[l1]):
                turns.append(make_turn(decode(path), key=f"{speaker}/{path.stem}", lang="en",
                                       source="l2arctic", group="l2arctic", license="CC-BY-NC-4.0",
                                       accent_l1=l1))
        print(f"l2arctic L1 {l1}: {len(speakers) * L2ARCTIC_PER_SPEAKER[l1]}")
    return turns


class MissingSource(Exception):
    """A source that needs a human terms acceptance before it can be fetched."""


SOURCES = {"fleurs": fleurs, "esc50": esc50, "cv": common_voice, "l2arctic": l2arctic}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sources", default=",".join(SOURCES))
    args = parser.parse_args()

    requested = args.sources.split(",")
    manifest = OUT / "manifest.jsonl"
    kept = [t for t in load(manifest) if t.source not in requested] if manifest.exists() else []
    turns: list[Turn] = list(kept)
    missing: list[str] = []
    for name in requested:
        try:
            turns.extend(SOURCES[name]())
        except MissingSource as err:
            missing.append(str(err))
    save(manifest, turns)
    print(f"wrote {len(turns)} turns to {manifest.relative_to(BENCH_ROOT)}")
    for message in missing:
        print(f"MISSING: {message}", file=sys.stderr)
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
