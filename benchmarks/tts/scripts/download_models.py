"""Fetch and extract both TTS model packages from k2-fsa release assets.

Idempotent. Run: uv run python scripts/download_models.py
"""

import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = BENCH_ROOT / "models"

RELEASE_BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models"
# asset -> (extracted dir name, file that proves complete extraction)
PACKAGES = {
    "kokoro-en-v0_19.tar.bz2": ("kokoro-en-v0_19", "voices.bin"),
    "vits-piper-en_US-lessac-high.tar.bz2": (
        "vits-piper-en_US-lessac-high",
        "en_US-lessac-high.onnx",
    ),
}


def fetch_package(asset: str, out_dir_name: str, marker_file: str) -> None:
    out_dir = MODELS_DIR / out_dir_name
    if (out_dir / marker_file).exists():
        print(f"[{out_dir_name}] ready (cached)")
        return
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    tar_path = MODELS_DIR / asset
    if not tar_path.exists():
        url = f"{RELEASE_BASE}/{asset}"
        print(f"[{out_dir_name}] downloading {url}")
        tmp = tar_path.with_suffix(".part")
        with urllib.request.urlopen(url, timeout=60) as response, open(tmp, "wb") as out:
            shutil.copyfileobj(response, out, length=1024 * 1024)
        tmp.rename(tar_path)
    print(f"[{out_dir_name}] extracting")
    with tarfile.open(tar_path, "r:bz2") as tar:
        tar.extractall(MODELS_DIR, filter="data")
    if not (out_dir / marker_file).exists():
        raise RuntimeError(f"unexpected tarball layout; {out_dir} incomplete")
    tar_path.unlink()
    print(f"[{out_dir_name}] ready")


def main() -> int:
    for asset, (out_dir_name, marker_file) in PACKAGES.items():
        fetch_package(asset, out_dir_name, marker_file)
    print("[done] all TTS models cached in models/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
