"""Fetch and cache the sidecar's model weights into models/ (gitignored).

- Zipformer-30M vi: encoder/decoder/joiner INT8 ONNX + bpe.model from HF, then
  generates tokens.txt from bpe.model (the repo does not ship one; sherpa-onnx
  requires the "SYMBOL ID" token table).
- Moonshine base en INT8 (live partials) and Parakeet-TDT-0.6b-v2 en INT8
  (finals): k2-fsa release tarballs, extracted.
- CAM++ speaker embedding: one ONNX file from the k2-fsa speaker release. fp32,
  because that release publishes no int8 variant of any speaker model.

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

K2_ASR_RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models"

# The release tag is misspelled upstream ("recongition"). Copied verbatim: the
# corrected spelling 404s.
CAMPPLUS_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/"
    "speaker-recongition-models/"
    "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"
)


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


def fetch_k2_asr_tarball(name: str, label: str) -> None:
    """One k2-fsa `asr-models` release tarball, extracted into models/<name>/.

    tokens.txt is the readiness marker: every sherpa-onnx package ships one,
    and it is the file the engine fails on first when a download was cut short.
    """
    out_dir = MODELS_DIR / name
    if (out_dir / "tokens.txt").exists():
        print(f"[{label}] ready (cached)")
        return
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    url = f"{K2_ASR_RELEASE}/{name}.tar.bz2"
    tar_path = MODELS_DIR / f"{name}.tar.bz2"
    if not tar_path.exists():
        print(f"[{label}] downloading {url}")
        tmp = tar_path.with_suffix(".part")
        with urllib.request.urlopen(url, timeout=60) as response, open(
            tmp, "wb"
        ) as out:
            shutil.copyfileobj(response, out, length=1024 * 1024)
        tmp.rename(tar_path)
    print(f"[{label}] extracting")
    with tarfile.open(tar_path, "r:bz2") as tar:
        tar.extractall(MODELS_DIR, filter="data")
    if not (out_dir / "tokens.txt").exists():
        raise RuntimeError(f"unexpected tarball layout; {out_dir} incomplete")
    tar_path.unlink()
    print(f"[{label}] ready")


def fetch_moonshine_en() -> None:
    fetch_k2_asr_tarball("sherpa-onnx-moonshine-base-en-int8", "moonshine-en")


def fetch_parakeet_en() -> None:
    """English finals. ~630MB extracted; skipped nowhere, because an engine the
    registry routes to must exist even while LOCAL_STT_EN_FINAL rolls it back —
    flipping the flag forward again should not need a download."""
    fetch_k2_asr_tarball("sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", "parakeet-en")


def fetch_campplus_speaker() -> None:
    """The speaker embedding model behind POST /embed.

    One flat .onnx rather than a directory, so unlike the two above there is
    nothing to extract and the file's own presence is the cache check.
    """
    target = MODELS_DIR / "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"
    if target.exists():
        print("[campplus-speaker] ready (cached)")
        return
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[campplus-speaker] downloading {CAMPPLUS_URL}")
    # Downloaded to .part and renamed, so an interrupted run leaves no truncated
    # file that the existence check above would treat as cached.
    tmp = target.with_suffix(".part")
    with urllib.request.urlopen(CAMPPLUS_URL, timeout=60) as response, open(tmp, "wb") as out:
        shutil.copyfileobj(response, out, length=1024 * 1024)
    tmp.rename(target)
    print("[campplus-speaker] ready")


def main() -> int:
    for fetch in (
        fetch_zipformer_vi,
        fetch_moonshine_en,
        fetch_parakeet_en,
        fetch_campplus_speaker,
    ):
        fetch()
    print("[done] models cached in models/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
