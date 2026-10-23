"""Export NVIDIA AmberNet (`langid_ambernet`, NeMo) to what the sidecar could run.

Writes into `benchmarks/lid/models/ambernet/`:
- `ambernet.onnx`: encoder + decoder, input = log-mel features (NeMo exports
  without the preprocessor);
- `frontend.npz`: the preprocessor's OWN filterbank and window tensors plus
  its scalars, so the numpy frontend (`frontend.py`) reproduces NeMo's
  features instead of re-deriving them;
- `labels.json`: the 107 output labels in logit order;
- `provenance.json`: the `.nemo` file's sha256 and size, and the NGC version.

AmberNet is published on NGC (no Hugging Face mirror from NVIDIA), under the
NGC Terms of Use: redistribution of a derived ONNX is NOT assumed. The gate
cannot call it G1 until `provenance.json` records an immutable host and a
licence that allows redistribution (phase-00 step 7).

Run as `lidbench` (it downloads and unpickles a `.nemo`):
    uv run --frozen python export_onnx.py
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[1] / "models" / "ambernet"
NGC_NAME = "langid_ambernet"
#: First fetch writes the hash here; every later export must match it.
PINNED = HERE / "pins.json"


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    import torch
    from nemo.collections.asr.models import EncDecSpeakerLabelModel

    model = EncDecSpeakerLabelModel.from_pretrained(NGC_NAME, map_location="cpu")
    model.eval()
    # from_pretrained caches the NGC download under NeMo's cache directory; the
    # newest matching .nemo there is the file that was just loaded.
    cached = sorted((Path.home() / ".cache" / "torch" / "NeMo").rglob(f"{NGC_NAME}*.nemo"),
                    key=lambda p: p.stat().st_mtime)
    source = cached[-1] if cached else None
    provenance = {"ngc_name": NGC_NAME, "licence": "NGC Terms of Use (redistribution not assumed)",
                  "host": None, "redistribution_ok": False}
    if source is not None:
        provenance |= {"nemo_file": source.name, "sha256": sha256_of(source), "size": source.stat().st_size}
        if PINNED.exists():
            pinned = json.loads(PINNED.read_text())
            if pinned["sha256"] != provenance["sha256"]:
                print(f"refusing: {source.name} sha256 changed since it was pinned", file=sys.stderr)
                return 1
        else:
            PINNED.write_text(json.dumps({"sha256": provenance["sha256"], "size": provenance["size"]}, indent=2) + "\n")

    OUT.mkdir(parents=True, exist_ok=True)
    model.export(str(OUT / "ambernet.onnx"))
    featurizer = model.preprocessor.featurizer
    np.savez(
        OUT / "frontend.npz",
        filterbank=featurizer.fb.squeeze(0).cpu().numpy(),
        window=featurizer.window.cpu().numpy() if featurizer.window is not None else np.ones(featurizer.win_length),
        n_fft=featurizer.n_fft, hop_length=featurizer.hop_length, win_length=featurizer.win_length,
        preemph=featurizer.preemph or 0.0, log_zero_guard=featurizer.log_zero_guard_value_fn(torch.zeros(1)),
        mag_power=featurizer.mag_power, pad_to=featurizer.pad_to,
        normalize=str(featurizer.normalize),
    )
    labels = list(model._cfg.train_ds.labels if "train_ds" in model._cfg else model._cfg.labels)
    (OUT / "labels.json").write_text(json.dumps(labels) + "\n")
    (OUT / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    print(f"exported {len(labels)} labels to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
