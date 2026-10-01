"""Dewpoint (valkayuh/dewpoint), through the copy the local-stt sidecar vendors.

Variants:
- mmbert-int8emb: the prod artifact — the sidecar's seed output, with the
  embedding table quantized (services/local-stt/models/dewpoint-mmbert-base).
- mmbert-fp32:    the published mmBERT graph, unquantized.
- xlmr-large:     the XLM-R-large member alone.
- ensemble:       both members, as the author ships it.

The model alone, without the sidecar's number guard or its hotword gazetteer,
so every arm is the bare model on the same input.
"""
import sys
from pathlib import Path

from huggingface_hub import snapshot_download

from punct_bench.arm_protocol import main

REPO = Path(__file__).resolve().parents[3]
SIDECAR = REPO / "services" / "local-stt"
sys.path.insert(0, str(SIDECAR / "punctuation"))
from dewpoint import Punctuator  # noqa: E402

# The revision the sidecar pins; the published files must be the measured ones.
REVISION = "4c45df7c148d096df50c8fbf47a9b0e34f08da68"
PROD_DIR = SIDECAR / "models" / "dewpoint-mmbert-base"

_MEMBERS = {
    "mmbert-fp32": ["mmbert-base"],
    "xlmr-large": ["xlm-roberta-large"],
    "ensemble": ["mmbert-base", "xlm-roberta-large"],
}


def load(variant: str, threads: int):
    if variant == "mmbert-int8emb":
        punctuator = Punctuator(str(PROD_DIR), members=["mmbert-base"], backend="onnx", threads=threads)
    else:
        members = _MEMBERS[variant]
        patterns = ["*.json", "*.py"] + [f"{m}/*" for m in members] + [f"onnx/{m}/*" for m in members]
        # A real directory, not the hub cache: onnxruntime refuses an external
        # data file (XLM-R-large's `model.onnx.data`) reached through the
        # cache's symlinks, as a path escaping the model directory.
        local = Path.home() / ".cache" / "chatofy-punct" / f"dewpoint-{REVISION[:8]}"
        path = snapshot_download("valkayuh/dewpoint", revision=REVISION, allow_patterns=patterns, local_dir=local)
        punctuator = Punctuator(path, members=members, backend="onnx", threads=threads)
    return lambda text: punctuator.restore(text, lang="vi")


if __name__ == "__main__":
    main(load)
