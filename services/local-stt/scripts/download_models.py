"""Fetch and cache the STT model weights into models/ (gitignored).

- Zipformer-30M vi: encoder/decoder/joiner INT8 ONNX + bpe.model from HF, then
  generates tokens.txt from bpe.model (the repo does not ship one; sherpa-onnx
  requires the "SYMBOL ID" token table).
- Moonshine base en INT8: k2-fsa release tarball, extracted.
- Nemotron streaming vi: q8_0 GGUF for parakeet.cpp. Weights only — the runtime
  itself is a C++ library you build once; see README.

Idempotent; safe to re-run.
Run: uv run --directory services/local-stt python scripts/download_models.py
"""
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

from huggingface_hub import hf_hub_download

SERVICE_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = SERVICE_ROOT / "models"

ZIPFORMER_REPO = "hynt/Zipformer-30M-RNNT-6000h"
ZIPFORMER_FILES = [
    "encoder-epoch-20-avg-10.int8.onnx",
    "decoder-epoch-20-avg-10.int8.onnx",
    "joiner-epoch-20-avg-10.int8.onnx",
    "bpe.model",
]

MOONSHINE_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/"
    "sherpa-onnx-moonshine-base-en-int8.tar.bz2"
)

NEMOTRON_REPO = "mudler/parakeet-cpp-gguf"
NEMOTRON_FILE = "nemotron-3.5-asr-streaming-0.6b-q8_0.gguf"


def fetch_zipformer_vi() -> None:
    out_dir = MODELS_DIR / "zipformer-vi-30m"
    out_dir.mkdir(parents=True, exist_ok=True)
    for filename in ZIPFORMER_FILES:
        target = out_dir / filename
        if target.exists():
            continue
        print(f"[zipformer-vi] fetching {filename}")
        cached = hf_hub_download(ZIPFORMER_REPO, filename)
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
        with urllib.request.urlopen(MOONSHINE_URL, timeout=60) as response, open(
            tmp, "wb"
        ) as out:
            shutil.copyfileobj(response, out, length=1024 * 1024)
        tmp.rename(tar_path)
    print("[moonshine-en] extracting")
    with tarfile.open(tar_path, "r:bz2") as tar:
        tar.extractall(MODELS_DIR, filter="data")
    if not (out_dir / "tokens.txt").exists():
        raise RuntimeError(f"unexpected tarball layout; {out_dir} incomplete")
    tar_path.unlink()
    print("[moonshine-en] ready")


def fetch_nemotron_vi() -> None:
    """Fetch the q8_0 GGUF the streaming Vietnamese engine loads.

    Note the repo: NVIDIA publishes its own GGUF for this model, but it targets a
    different runtime and parakeet.cpp cannot load it. This is the community
    conversion built for parakeet.cpp, and q8_0 was measured at 0.0000% WER drift
    from f32.
    """
    out_dir = MODELS_DIR / "nemotron-streaming-0.6b"
    target = out_dir / NEMOTRON_FILE
    if target.exists():
        print("[nemotron-vi] ready (cached)")
        return
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"[nemotron-vi] fetching {NEMOTRON_FILE} (~1GB)")
    cached = hf_hub_download(NEMOTRON_REPO, NEMOTRON_FILE)
    shutil.copyfile(cached, target)
    print("[nemotron-vi] ready")


def main() -> int:
    for fetch in (fetch_zipformer_vi, fetch_moonshine_en, fetch_nemotron_vi):
        fetch()
    print("[done] STT models cached in models/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
