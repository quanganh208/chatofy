"""Fetch and cache all local model weights into models/ (gitignored).

- Zipformer-30M vi: encoder/decoder/joiner INT8 ONNX + bpe.model from HF, then
  generates tokens.txt from bpe.model (the repo does not ship one; sherpa-onnx
  requires the "SYMBOL ID" token table).
- Moonshine base en INT8: k2-fsa release tarball, extracted.
- PhoWhisper-small CT2: HF snapshot (community conversion of vinai model).
- whisper small.en CT2: official Systran conversion, HF snapshot.

Idempotent; safe to re-run. Run: uv run python scripts/download_models.py
"""

import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download

BENCH_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = BENCH_ROOT / "models"

MOONSHINE_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/"
    "sherpa-onnx-moonshine-base-en-int8.tar.bz2"
)


def fetch_zipformer_vi() -> None:
    out_dir = MODELS_DIR / "zipformer-vi-30m"
    out_dir.mkdir(parents=True, exist_ok=True)
    files = [
        "encoder-epoch-20-avg-10.int8.onnx",
        "decoder-epoch-20-avg-10.int8.onnx",
        "joiner-epoch-20-avg-10.int8.onnx",
        "bpe.model",
    ]
    for filename in files:
        target = out_dir / filename
        if target.exists():
            continue
        print(f"[zipformer-vi] fetching {filename}")
        cached = hf_hub_download("hynt/Zipformer-30M-RNNT-6000h", filename)
        shutil.copyfile(cached, target)

    tokens_path = out_dir / "tokens.txt"
    if not tokens_path.exists():
        print("[zipformer-vi] generating tokens.txt from bpe.model")
        import sentencepiece as spm

        sp = spm.SentencePieceProcessor()
        sp.load(str(out_dir / "bpe.model"))
        with open(tokens_path, "w", encoding="utf-8") as f:
            for token_id in range(sp.get_piece_size()):
                f.write(f"{sp.id_to_piece(token_id)} {token_id}\n")
    print("[zipformer-vi] ready")


def fetch_moonshine_en() -> None:
    out_dir = MODELS_DIR / "sherpa-onnx-moonshine-base-en-int8"
    if (out_dir / "tokens.txt").exists():
        print("[moonshine-en] ready (cached)")
        return
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    tar_path = MODELS_DIR / "sherpa-onnx-moonshine-base-en-int8.tar.bz2"
    if not tar_path.exists():
        print(f"[moonshine-en] downloading {MOONSHINE_URL}")
        tmp = tar_path.with_suffix(".part")
        with urllib.request.urlopen(MOONSHINE_URL, timeout=60) as response, open(tmp, "wb") as out:
            shutil.copyfileobj(response, out, length=1024 * 1024)
        tmp.rename(tar_path)
    print("[moonshine-en] extracting")
    with tarfile.open(tar_path, "r:bz2") as tar:
        tar.extractall(MODELS_DIR, filter="data")
    if not (out_dir / "tokens.txt").exists():
        raise RuntimeError(f"unexpected tarball layout; {out_dir} incomplete")
    tar_path.unlink()
    print("[moonshine-en] ready")


def fetch_phowhisper_small_ct2() -> None:
    out_dir = MODELS_DIR / "phowhisper-small-ct2"
    if (out_dir / "model.bin").exists():
        print("[phowhisper-vi] ready (cached)")
        return
    print("[phowhisper-vi] snapshot diepho/PhoWhisper-small-ct2")
    snapshot_download("diepho/PhoWhisper-small-ct2", local_dir=out_dir)
    print("[phowhisper-vi] ready")


def fetch_whisper_small_en_ct2() -> None:
    out_dir = MODELS_DIR / "faster-whisper-small.en"
    if (out_dir / "model.bin").exists():
        print("[whisper-small-en] ready (cached)")
        return
    print("[whisper-small-en] snapshot Systran/faster-whisper-small.en")
    snapshot_download("Systran/faster-whisper-small.en", local_dir=out_dir)
    print("[whisper-small-en] ready")


def main() -> int:
    for fetch in (
        fetch_zipformer_vi,
        fetch_moonshine_en,
        fetch_phowhisper_small_ct2,
        fetch_whisper_small_en_ct2,
    ):
        fetch()
    print("[done] all local models cached in models/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
