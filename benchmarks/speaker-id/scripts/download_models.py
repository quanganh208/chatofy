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

import hashlib
import sys
import urllib.request
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from speaker_bench.embed import CANDIDATES  # noqa: E402

MODELS_DIR = BENCH_ROOT / "models"
CLIPS_DIR = MODELS_DIR / "smoke-clips"

RELEASE = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models"
)

#: Every model the bench knows about, resolved from the ONE registry that bench
#: scripts actually use. Listing filenames here a second time is how the two
#: drift apart: `download_models.py` only fetches bytes, while `CANDIDATES` is
#: what 11 call sites across 9 files resolve models through.
#:
#: The English VoxCeleb model is a BASELINE — two advisory opinions disagreed on
#: whether it is viable for Vietnamese, so it is measured rather than argued
#: about. The Phase 5 entries are SCREEN candidates and ship nothing until they
#: clear the adoption bar.
MODELS = [spec.filename for spec in CANDIDATES.values()]

#: Expected digests, keyed by filename. Pinned on FIRST FETCH — the sherpa-onnx
#: release publishes no checksums, so this cannot attest provenance. What it
#: does do is fail loudly if a download truncates, or if the bytes behind a
#: stable URL ever change, which for a model that gets baked into the production
#: image is the difference between a caught substitution and a silent one.
DIGESTS = {spec.filename: spec.sha256 for spec in CANDIDATES.values() if spec.sha256}

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


def digest(path: Path) -> str:
    """SHA-256 of a file, read in chunks so a 40MB model is not held in memory."""
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            hasher.update(block)
    return hasher.hexdigest()


def fetch(name: str, out_dir: Path) -> Path:
    """Download one asset unless it is already present, non-empty and verified."""
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / name
    expected = DIGESTS.get(name)
    if path.exists() and path.stat().st_size > 0:
        if expected is None or digest(path) == expected:
            print(f"  ok      {name} ({path.stat().st_size / 1e6:.1f}MB)")
            return path
        # A present-but-wrong file is worse than an absent one: every later run
        # would skip it on size alone. Say so and re-fetch.
        print(f"  BAD     {name} digest mismatch, re-fetching")
        path.unlink()

    url = f"{RELEASE}/{name}"
    print(f"  fetch   {name} ...", flush=True)
    # Download to a temporary name and verify BEFORE the rename, so a corrupted
    # or substituted payload never occupies the real path even briefly — and so
    # an interrupted run leaves nothing a later run would mistake for complete.
    staging = path.with_suffix(path.suffix + ".partial")
    try:
        urllib.request.urlretrieve(url, staging)
        if expected is not None:
            actual = digest(staging)
            if actual != expected:
                raise RuntimeError(
                    f"{name}: sha256 mismatch\n"
                    f"  expected {expected}\n"
                    f"  actual   {actual}\n"
                    "The bytes behind this URL changed. Do NOT adopt this file "
                    "until the change is explained."
                )
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
