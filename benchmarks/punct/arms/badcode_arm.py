"""1-800-BAD-CODE/xlm-roberta_punctuation_fullstop_truecase, through its reference wrapper.

License: apache-2.0. Pinned to REVISION. A control: Vietnamese is not among the
model's 47 training languages (the card's list has no `vi`), and the graph has
no language-specific path, so this measures what a language-agnostic punctuator
does on Vietnamese.

Reference procedure is the card's `punctuators` usage and the repo's own
pipeline.py: `PunctCapSegModelONNX(PunctCapSegConfigONNX(directory=<repo>,
spe_filename="sp.model", model_filename="model.onnx", config_filename="config.yaml"))`
then `infer([text], apply_sbd=True)`. That is the wrapper's defaults:
batch_size_tokens=4096, overlap=16 between 256-token windows (config max_length),
sentence-boundary head on. The result is one string per predicted sentence;
they are joined with a single space. The model predicts a pre-mark (`¿`), a
post-mark (`. , ? …`, plus CJK/Arabic/Amharic variants), per-character truecase
and sentence boundaries, so it can insert marks Vietnamese does not use and
recase inside a word; the scorer flags word changes itself.

Two things differ from the wrapper's bare use: the repo is loaded from the pinned
snapshot (`from_pretrained` follows the moving main branch), and the ONNX
session gets the harness's thread count (the wrapper opens it with ort's default,
every core).
"""
import types

import onnxruntime as ort
from huggingface_hub import snapshot_download
from punctuators.models import punc_cap_seg_model
from punctuators.models.punc_cap_seg_model import PunctCapSegConfigONNX, PunctCapSegModelONNX

from punct_bench.arm_protocol import main

REPO = "1-800-BAD-CODE/xlm-roberta_punctuation_fullstop_truecase"
REVISION = "d1769a597ce8dfaa070d436bc67d4ee761f58884"


def _session_with_threads(threads: int):
    def create(path, *args, **kwargs):
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        return ort.InferenceSession(path, options, providers=["CPUExecutionProvider"])

    return types.SimpleNamespace(InferenceSession=create)


def load(variant: str, threads: int):
    path = snapshot_download(REPO, revision=REVISION, allow_patterns=["model.onnx", "sp.model", "config.yaml"])
    config = PunctCapSegConfigONNX(
        directory=path, spe_filename="sp.model", model_filename="model.onnx", config_filename="config.yaml"
    )
    real_ort = punc_cap_seg_model.ort
    punc_cap_seg_model.ort = _session_with_threads(threads)
    try:
        model = PunctCapSegModelONNX(config)
    finally:
        punc_cap_seg_model.ort = real_ort
    return lambda text: " ".join(model.infer([text], apply_sbd=True)[0])


if __name__ == "__main__":
    main(load)
