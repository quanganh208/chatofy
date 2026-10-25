"""Fetch a Hub file at a pinned commit and refuse it unless its sha256 matches.

Every model artifact an arm loads goes through here (`pins.json` beside the
arm): the revision makes the request immutable, the hash makes a swapped file
an error instead of a different measurement. Same convention as
`services/local-stt/scripts/download_models.py`.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

MODELS = Path(__file__).resolve().parents[1] / "models"
DATASETS = Path(__file__).resolve().parents[1] / "data" / "downloads"


class PinMismatch(Exception):
    pass


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def fetch(pin: dict) -> Path:
    """Download every file of one pin (model or dataset repo); return the local
    snapshot directory. Files already present are re-hashed, not re-fetched."""
    from huggingface_hub import hf_hub_download

    root = MODELS if pin.get("repo_type", "model") == "model" else DATASETS
    local = root / pin["repo"].replace("/", "--") / pin["revision"]
    for spec in pin["files"]:
        path = Path(hf_hub_download(pin["repo"], spec["name"], revision=pin["revision"], local_dir=local,
                                    repo_type=pin.get("repo_type", "model")))
        actual = sha256_of(path)
        if actual != spec["sha256"]:
            raise PinMismatch(f"{pin['repo']}@{pin['revision'][:8]} {spec['name']}: sha256 {actual} != pinned")
    return local
