"""Fetch speaker-embedding weights and the smoke-test clips into models/.

Idempotent; safe to re-run. Mirrors the style of
`services/local-stt/scripts/download_models.py`, and like it keeps weights out of
git — they are gitignored, they dwarf the code, and the bench is standalone.

Everything comes from one sherpa-onnx release. There is **no int8 variant of any
speaker embedding model** there (unlike the ASR models), so these are fp32 and
total ~129MB. Do not self-quantise before Phase 3 has measured the fp32 numbers.

Run:
    uv run --directory benchmarks/speaker-id python scripts/download_models.py
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = BENCH_ROOT / "models"
CLIPS_DIR = MODELS_DIR / "smoke-clips"

RELEASE = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models"
)

#: The three Phase 3 candidates. The English VoxCeleb model is a BASELINE — two
#: advisory opinions disagreed on whether it is viable for Vietnamese, so it is
#: measured rather than argued about.
MODELS = [
    "3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx",
    "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
    "wespeaker_en_voxceleb_CAM++.onnx",
]

#: Labelled clips shipped with the release: three speakers, several utterances
#: each. Used by the Phase 2 smoke test, which only has to establish that
#: same-speaker similarity exceeds different-speaker similarity — i.e. that the
#: wiring is right. Real accuracy is Phase 3's job, on the real channel.
SMOKE_CLIPS = [
    "fangjun-sr-1.wav",
    "fangjun-sr-2.wav",
    "fangjun-test-sr-1.wav",
    "leijun-sr-1.wav",
    "leijun-sr-2.wav",
    "leijun-test-sr-1.wav",
    "liudehua-sr-1.wav",
    "liudehua-sr-2.wav",
    "liudehua-test-sr-1.wav",
]


def fetch(name: str, out_dir: Path) -> Path:
    """Download one asset unless it is already present and non-empty."""
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / name
    if path.exists() and path.stat().st_size > 0:
        print(f"  ok      {name} ({path.stat().st_size / 1e6:.1f}MB)")
        return path

    url = f"{RELEASE}/{name}"
    print(f"  fetch   {name} ...", flush=True)
    # Download to a temporary name and rename on success, so an interrupted run
    # leaves nothing that a later run would mistake for a complete file.
    staging = path.with_suffix(path.suffix + ".partial")
    try:
        urllib.request.urlretrieve(url, staging)
        staging.replace(path)
    finally:
        staging.unlink(missing_ok=True)
    print(f"  done    {name} ({path.stat().st_size / 1e6:.1f}MB)")
    return path


def main() -> int:
    print(f"models -> {MODELS_DIR}")
    for name in MODELS:
        fetch(name, MODELS_DIR)

    print(f"smoke clips -> {CLIPS_DIR}")
    for name in SMOKE_CLIPS:
        fetch(name, CLIPS_DIR)

    print("\nready. Next: uv run pytest")
    return 0


if __name__ == "__main__":
    sys.exit(main())
