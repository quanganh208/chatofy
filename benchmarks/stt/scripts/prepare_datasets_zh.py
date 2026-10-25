"""Build the two Mandarin (zh) benchmark manifests from ungated HF parquet.

- FLEURS `cmn_hans_cn` test (google/fleurs, CC-BY-4.0): read speech, many
  speakers. Reference = `raw_transcription` (the written sentence; punctuation
  is stripped by the zh normalizer before scoring).
- AISHELL-1 test (AudioLLMs/aishell_1_zh_test, OpenSLR 33 Apache-2.0): clean
  read speech. The parquet carries no utterance id, so the id is the row's
  global index across the three shards in file order.

Same selection rule as `prepare_datasets.py`: 3-10 s, 50 utterances, seed 42,
`random.Random(seed).sample` over the in-range items sorted by id, written as
16 kHz mono PCM16 WAV. Writes data/manifest-zh-{fleurs,aishell}.jsonl.

Parquet files are fetched into data/downloads-zh/{fleurs-cmn,aishell1}/ and
treated as untrusted data: only the audio bytes (decoded by libsndfile) and the
text columns are read.

Run (pyarrow is needed only here, so it is not a harness dependency):
    uv run --with pyarrow python -I scripts/prepare_datasets_zh.py
"""

import argparse
import io
import json
import random
import shutil
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import soundfile as sf

BENCH_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = BENCH_ROOT / "data"
DOWNLOADS_DIR = DATA_DIR / "downloads-zh"

MIN_DURATION_S = 3.0
MAX_DURATION_S = 10.0
TARGET_SAMPLE_RATE = 16_000

FLEURS_URLS = ["https://huggingface.co/api/datasets/google/fleurs/parquet/cmn_hans_cn/test/0.parquet"]
AISHELL_URLS = [
    f"https://huggingface.co/api/datasets/AudioLLMs/aishell_1_zh_test/parquet/default/test/{i}.parquet"
    for i in range(3)
]


@dataclass(frozen=True)
class Candidate:
    utt_id: str
    audio_bytes: bytes
    ref_text: str
    duration_s: float


def download(url: str, dest: Path) -> Path:
    """Stream-download url to dest unless already cached."""
    if dest.exists() and dest.stat().st_size > 0:
        print(f"[cache] {dest.relative_to(BENCH_ROOT)}")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"[download] {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        with urllib.request.urlopen(url, timeout=60) as response, open(tmp, "wb") as out:
            shutil.copyfileobj(response, out, length=1024 * 1024)
    except (urllib.error.URLError, OSError) as err:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"download failed for {url}: {err}") from err
    tmp.rename(dest)
    return dest


def _duration(audio_bytes: bytes) -> tuple[float, int, int]:
    info = sf.info(io.BytesIO(audio_bytes))
    return info.duration, info.samplerate, info.channels


def collect_fleurs() -> list[Candidate]:
    import pyarrow.parquet as pq

    path = download(FLEURS_URLS[0], DOWNLOADS_DIR / "fleurs-cmn" / "test-0.parquet")
    table = pq.read_table(path, columns=["id", "audio", "raw_transcription"]).to_pylist()
    items = []
    for row in table:
        audio = row["audio"]
        # FLEURS repeats a sentence id across speakers; the source file stem
        # is unique per recording, so the pair is the stable utterance id.
        stem = Path(audio["path"]).stem
        duration, _, _ = _duration(audio["bytes"])
        items.append(
            Candidate(f"fleurs-cmn-{row['id']}-{stem}", audio["bytes"], row["raw_transcription"].strip(), duration)
        )
    return items


def collect_aishell() -> list[Candidate]:
    import pyarrow.parquet as pq

    items = []
    global_idx = 0
    for shard, url in enumerate(AISHELL_URLS):
        path = download(url, DOWNLOADS_DIR / "aishell1" / f"test-{shard}.parquet")
        for row in pq.read_table(path, columns=["context", "answer"]).to_pylist():
            duration, _, _ = _duration(row["context"]["bytes"])
            items.append(
                Candidate(f"aishell1-test-{global_idx:05d}", row["context"]["bytes"], row["answer"].strip(), duration)
            )
            global_idx += 1
    return items


def select_and_write(items: list[Candidate], set_name: str, count: int, seed: int) -> list[dict]:
    in_range = sorted(
        (c for c in items if MIN_DURATION_S <= c.duration_s <= MAX_DURATION_S and c.ref_text),
        key=lambda c: c.utt_id,
    )
    if len(in_range) < count:
        raise RuntimeError(f"{set_name}: only {len(in_range)} utterances in 3-10s range, need {count}")
    selected = sorted(random.Random(seed).sample(in_range, count), key=lambda c: c.utt_id)

    audio_out_dir = DATA_DIR / "audio" / f"zh-{set_name}"
    audio_out_dir.mkdir(parents=True, exist_ok=True)
    records = []
    for cand in selected:
        # Read as float and let sf.write scale to PCM16: FLEURS ships IEEE-float
        # WAVs, and libsndfile's float->int16 READ path truncates instead of
        # scaling, which silently produced all-zero audio.
        samples, sample_rate = sf.read(io.BytesIO(cand.audio_bytes), dtype="float32")
        if sample_rate != TARGET_SAMPLE_RATE or samples.ndim != 1:
            # Both sources are 16 kHz mono; anything else is a bad download.
            raise RuntimeError(
                f"{cand.utt_id}: expected {TARGET_SAMPLE_RATE} Hz mono, got {sample_rate} Hz / shape {samples.shape}"
            )
        if not samples.any():
            raise RuntimeError(f"{cand.utt_id}: decoded audio is all zeros")
        wav_path = audio_out_dir / f"{cand.utt_id}.wav"
        sf.write(str(wav_path), samples, sample_rate, subtype="PCM_16")
        records.append(
            {
                "id": cand.utt_id,
                "lang": "zh",
                "audio_path": wav_path.relative_to(DATA_DIR).as_posix(),
                "ref_text": cand.ref_text,
                "duration_s": round(len(samples) / sample_rate, 3),
            }
        )
    return records


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--num", type=int, default=50)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    for set_name, collect in (("fleurs", collect_fleurs), ("aishell", collect_aishell)):
        print(f"=== zh-{set_name}: collecting ===")
        items = collect()
        print(f"[info] zh-{set_name}: {len(items)} utterances")
        records = select_and_write(items, set_name, args.num, args.seed)
        manifest_path = DATA_DIR / f"manifest-zh-{set_name}.jsonl"
        with open(manifest_path, "w", encoding="utf-8") as f:
            for record in records:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
        total_s = sum(r["duration_s"] for r in records)
        print(f"[done] {manifest_path.relative_to(BENCH_ROOT)} — {len(records)} utts, {total_s:.0f}s audio")
    return 0


if __name__ == "__main__":
    sys.exit(main())
