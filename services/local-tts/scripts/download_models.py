"""Fetch and extract the Kokoro TTS model package into models/ (gitignored).

Idempotent; safe to re-run.
Run: uv run --directory services/local-tts python scripts/download_models.py
"""
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = SERVICE_ROOT / "models"

RELEASE_BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models"
ASSET = "kokoro-multi-lang-v1_0.tar.bz2"
OUT_DIR_NAME = "kokoro-multi-lang-v1_0"
# Proves the extraction completed, not just started.
MARKER_FILE = "voices.bin"


def fetch_kokoro_en() -> None:
    out_dir = MODELS_DIR / OUT_DIR_NAME
    if (out_dir / MARKER_FILE).exists():
        print(f"[{OUT_DIR_NAME}] ready (cached)")
        return
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    tar_path = MODELS_DIR / ASSET
    if not tar_path.exists():
        url = f"{RELEASE_BASE}/{ASSET}"
        print(f"[{OUT_DIR_NAME}] downloading {url}")
        tmp = tar_path.with_suffix(".part")
        with urllib.request.urlopen(url, timeout=60) as response, open(tmp, "wb") as out:
            shutil.copyfileobj(response, out, length=1024 * 1024)
        tmp.rename(tar_path)
    print(f"[{OUT_DIR_NAME}] extracting")
    with tarfile.open(tar_path, "r:bz2") as tar:
        tar.extractall(MODELS_DIR, filter="data")
    if not (out_dir / MARKER_FILE).exists():
        raise RuntimeError(f"unexpected tarball layout; {out_dir} incomplete")
    tar_path.unlink()
    print(f"[{OUT_DIR_NAME}] ready")


def main() -> int:
    fetch_kokoro_en()
    print("[done] TTS model cached in models/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
