"""Fetch and cache all local model weights into models/ (gitignored).

- Zipformer-30M vi: encoder/decoder/joiner INT8 ONNX + bpe.model from HF, then
  generates tokens.txt and bpe.vocab from bpe.model (the repo ships neither;
  sherpa-onnx requires the "SYMBOL ID" token table, and the vocab only for
  the benchmark's hotword-biasing arm).
- Moonshine base en INT8: k2-fsa release tarball, extracted.
- PhoWhisper-small CT2: HF snapshot (community conversion of vinai model).
- whisper small.en CT2: official Systran conversion, HF snapshot.
- SenseVoice-Small int8 2024-07-17 and Paraformer-zh 2023-09-14 (zh arms):
  k2-fsa release tarballs, extracted.

Idempotent; safe to re-run. Run: uv run python scripts/download_models.py [--only sensevoice-zh,paraformer-zh]
"""

import argparse
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download

BENCH_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = BENCH_ROOT / "models"

SHERPA_RELEASE_BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models"
MOONSHINE_NAME = "sherpa-onnx-moonshine-base-en-int8"
# zh arms. SenseVoice is pinned to the 2024-07-17 multilingual release: the
# 2025-09-09 one is a Cantonese fine-tune that emits no punctuation.
SENSEVOICE_NAME = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"
PARAFORMER_NAME = "sherpa-onnx-paraformer-zh-2023-09-14"


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
    vocab_path = out_dir / "bpe.vocab"
    if not tokens_path.exists() or not vocab_path.exists():
        import sentencepiece as spm

        sp = spm.SentencePieceProcessor()
        sp.load(str(out_dir / "bpe.model"))
        if not tokens_path.exists():
            print("[zipformer-vi] generating tokens.txt from bpe.model")
            with open(tokens_path, "w", encoding="utf-8") as f:
                for token_id in range(sp.get_piece_size()):
                    f.write(f"{sp.id_to_piece(token_id)} {token_id}\n")
        if not vocab_path.exists():
            # sherpa-onnx encodes hotword phrases through the SentencePiece
            # vocabulary ("piece<TAB>score" lines); only the benchmark's
            # beam+hotwords arm needs it, and the repo ships no .vocab either.
            print("[zipformer-vi] generating bpe.vocab from bpe.model")
            with open(vocab_path, "w", encoding="utf-8") as f:
                for token_id in range(sp.get_piece_size()):
                    f.write(f"{sp.id_to_piece(token_id)}\t{sp.get_score(token_id)}\n")
    print("[zipformer-vi] ready")


def fetch_sherpa_release(name: str, label: str) -> None:
    """Download + extract one k2-fsa asr-models release tarball into models/{name}."""
    out_dir = MODELS_DIR / name
    if (out_dir / "tokens.txt").exists():
        print(f"[{label}] ready (cached)")
        return
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    url = f"{SHERPA_RELEASE_BASE}/{name}.tar.bz2"
    tar_path = MODELS_DIR / f"{name}.tar.bz2"
    if not tar_path.exists():
        print(f"[{label}] downloading {url}")
        tmp = tar_path.with_suffix(".part")
        with urllib.request.urlopen(url, timeout=60) as response, open(tmp, "wb") as out:
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
    fetch_sherpa_release(MOONSHINE_NAME, "moonshine-en")


def fetch_sensevoice_zh() -> None:
    fetch_sherpa_release(SENSEVOICE_NAME, "sensevoice-zh")


def fetch_paraformer_zh() -> None:
    fetch_sherpa_release(PARAFORMER_NAME, "paraformer-zh")


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


FETCHERS = {
    "zipformer-vi": fetch_zipformer_vi,
    "moonshine-en": fetch_moonshine_en,
    "phowhisper-vi": fetch_phowhisper_small_ct2,
    "whisper-small-en": fetch_whisper_small_en_ct2,
    "sensevoice-zh": fetch_sensevoice_zh,
    "paraformer-zh": fetch_paraformer_zh,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--only",
        help=f"comma-separated subset of {', '.join(FETCHERS)} (default: all)",
    )
    args = parser.parse_args()
    names = [n.strip() for n in args.only.split(",")] if args.only else list(FETCHERS)
    unknown = [n for n in names if n not in FETCHERS]
    if unknown:
        print(f"[error] unknown model(s) {unknown}; known: {list(FETCHERS)}", file=sys.stderr)
        return 1
    for name in names:
        FETCHERS[name]()
    print("[done] requested local models cached in models/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
