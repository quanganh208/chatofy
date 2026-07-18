"""Download public test corpora and build benchmark manifests.

- vi: VIVOS test split (AILAB VNU-HCM; CC BY-NC-SA 4.0 — measurement use only)
- en: LibriSpeech test-clean (OpenSLR 12; CC BY 4.0)

Selects N utterances per language with duration 3-10s using a fixed seed so the
test set is reproducible, converts audio to 16 kHz mono PCM16 WAV, and writes
data/manifest-{vi,en}.jsonl (audio paths relative to the manifest).

Run: uv run python scripts/prepare_datasets.py
Idempotent: tarballs cached in data/downloads/, extraction and selection re-run
cheaply. Delete data/ to start fresh.
"""

import argparse
import json
import random
import shutil
import sys
import tarfile
import urllib.error
import urllib.request
from pathlib import Path

import soundfile as sf

BENCH_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = BENCH_ROOT / "data"
DOWNLOADS_DIR = DATA_DIR / "downloads"
EXTRACT_DIR = DATA_DIR / "extracted"

MIN_DURATION_S = 3.0
MAX_DURATION_S = 10.0
TARGET_SAMPLE_RATE = 16_000

# Primary + fallback URLs per corpus; first reachable wins.
VIVOS_URLS = [
    "https://huggingface.co/datasets/AILAB-VNUHCM/vivos/resolve/main/data/vivos.tar.gz",
    "https://ailab.hcmus.edu.vn/assets/vivos.tar.gz",
]
LIBRISPEECH_URLS = [
    "https://www.openslr.org/resources/12/test-clean.tar.gz",
    "https://us.openslr.org/resources/12/test-clean.tar.gz",
]


def download_first_available(urls: list[str], dest: Path) -> Path:
    """Stream-download the first reachable URL to dest (skips if cached)."""
    if dest.exists() and dest.stat().st_size > 0:
        print(f"[cache] {dest.name} already downloaded")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    for url in urls:
        print(f"[download] {url}")
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                tmp = dest.with_suffix(dest.suffix + ".part")
                with open(tmp, "wb") as out:
                    shutil.copyfileobj(response, out, length=1024 * 1024)
                tmp.rename(dest)
            return dest
        except (urllib.error.URLError, OSError) as err:
            print(f"[warn] failed: {err}")
            last_error = err
    raise RuntimeError(f"all mirrors failed for {dest.name}: {last_error}")


def extract_members(tar_path: Path, member_prefix: str, out_dir: Path) -> None:
    """Extract only members under member_prefix (skips if already extracted)."""
    marker = out_dir / f".extracted-{tar_path.stem}"
    if marker.exists():
        print(f"[cache] {tar_path.name} already extracted")
        return
    print(f"[extract] {tar_path.name} ({member_prefix}*)")
    out_dir.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tar_path, "r:gz") as tar:
        members = [m for m in tar.getmembers() if m.name.startswith(member_prefix)]
        tar.extractall(out_dir, members=members, filter="data")
    marker.touch()


def collect_vivos_test() -> list[tuple[str, Path, str]]:
    """Return (utt_id, wav_path, transcript) for the VIVOS test split."""
    tar_path = download_first_available(VIVOS_URLS, DOWNLOADS_DIR / "vivos.tar.gz")
    extract_members(tar_path, "vivos/test/", EXTRACT_DIR)
    test_dir = EXTRACT_DIR / "vivos" / "test"
    prompts_file = test_dir / "prompts.txt"
    transcripts: dict[str, str] = {}
    with open(prompts_file, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            utt_id, _, text = line.partition(" ")
            transcripts[utt_id] = text.strip()
    items = []
    for wav_path in sorted(test_dir.glob("waves/*/*.wav")):
        utt_id = wav_path.stem
        if utt_id in transcripts:
            items.append((utt_id, wav_path, transcripts[utt_id]))
    return items


def collect_librispeech_test_clean() -> list[tuple[str, Path, str]]:
    """Return (utt_id, flac_path, transcript) for LibriSpeech test-clean."""
    tar_path = download_first_available(LIBRISPEECH_URLS, DOWNLOADS_DIR / "test-clean.tar.gz")
    extract_members(tar_path, "LibriSpeech/test-clean/", EXTRACT_DIR)
    test_dir = EXTRACT_DIR / "LibriSpeech" / "test-clean"
    items = []
    for trans_file in sorted(test_dir.glob("*/*/*.trans.txt")):
        chapter_dir = trans_file.parent
        with open(trans_file, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                utt_id, _, text = line.partition(" ")
                flac_path = chapter_dir / f"{utt_id}.flac"
                if flac_path.is_file():
                    items.append((utt_id, flac_path, text.strip()))
    return items


def select_and_convert(
    items: list[tuple[str, Path, str]], lang: str, count: int, seed: int
) -> list[dict]:
    """Filter by duration, deterministically sample, convert to 16k mono WAV."""
    in_range = []
    for utt_id, audio_path, text in items:
        info = sf.info(str(audio_path))
        if MIN_DURATION_S <= info.duration <= MAX_DURATION_S:
            in_range.append((utt_id, audio_path, text, info))
    if len(in_range) < count:
        raise RuntimeError(f"{lang}: only {len(in_range)} utterances in 3-10s range, need {count}")

    rng = random.Random(seed)
    selected = sorted(rng.sample(in_range, count), key=lambda item: item[0])

    audio_out_dir = DATA_DIR / "audio" / lang
    audio_out_dir.mkdir(parents=True, exist_ok=True)
    records = []
    for utt_id, audio_path, text, info in selected:
        if info.samplerate != TARGET_SAMPLE_RATE or info.channels != 1:
            # VIVOS and LibriSpeech are both 16 kHz mono; anything else means a
            # corrupted download rather than a resampling job.
            raise RuntimeError(
                f"{audio_path}: expected {TARGET_SAMPLE_RATE} Hz mono, "
                f"got {info.samplerate} Hz / {info.channels}ch"
            )
        samples, sample_rate = sf.read(str(audio_path), dtype="int16")
        wav_path = audio_out_dir / f"{utt_id}.wav"
        sf.write(str(wav_path), samples, sample_rate, subtype="PCM_16")
        records.append(
            {
                "id": utt_id,
                "lang": lang,
                "audio_path": wav_path.relative_to(DATA_DIR).as_posix(),
                "ref_text": text,
                "duration_s": round(info.duration, 3),
            }
        )
    return records


def write_manifest(records: list[dict], lang: str) -> Path:
    manifest_path = DATA_DIR / f"manifest-{lang}.jsonl"
    with open(manifest_path, "w", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return manifest_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--num-per-lang", type=int, default=50)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--langs", default="vi,en", help="comma-separated subset of vi,en")
    args = parser.parse_args()

    collectors = {"vi": collect_vivos_test, "en": collect_librispeech_test_clean}
    for lang in args.langs.split(","):
        lang = lang.strip()
        if lang not in collectors:
            print(f"[error] unknown lang {lang!r}", file=sys.stderr)
            return 1
        print(f"=== {lang}: collecting corpus ===")
        items = collectors[lang]()
        print(f"[info] {lang}: {len(items)} utterances with transcripts")
        records = select_and_convert(items, lang, args.num_per_lang, args.seed)
        manifest_path = write_manifest(records, lang)
        total_s = sum(r["duration_s"] for r in records)
        print(f"[done] {manifest_path} — {len(records)} utts, {total_s:.0f}s audio")
    return 0


if __name__ == "__main__":
    sys.exit(main())
