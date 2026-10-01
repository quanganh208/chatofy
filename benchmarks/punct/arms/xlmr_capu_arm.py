"""XLM-RoBERTa capu (dragonSwing/xlm-roberta-capu) with its own reference code.

License: cc-by-sa-4.0. Repo and the two xlm-roberta-base lookups its code makes
are pinned to revisions below.

Reference procedure is the card's: `GecBERTModel(vocab_path=<repo>/vocabulary,
model_paths=<repo>, split_chunk=True)` called on the text, with every other
argument at its default (iterations=3, min_error_probability=0.0, min_len=3,
max_len=64, chunk 48 / overlap 12). The repo's own gec_model.py,
modeling_seq2labels.py, utils.py and vocabulary.py are imported unmodified, so
the decode is the author's, not a port; see vibert_capu_arm.py for what each
step does. Same GECToR label set as vibert-capu.

Actions that change a word: `$TRANSFORM_VERB_*` replaces the word through
verb-form-vocab.txt, a Vietnamese number-word table (`năm_5`, `một_1`, ...), so
"năm năm tới" can come out "5 năm tới"; `$MERGE_SPACE` joins a word to the next
(word count drops). Case and `$APPEND_*` keep the word. The scorer flags word
changes itself.

Four things differ from a bare run of the card; none changes the decode:
- the repo's .py files are copied into a temp dir first, as the card's own
  download snippet does (utils.py finds verb-form-vocab.txt through
  `Path(__file__).resolve()`, which a HF-cache symlink breaks);
- `xlm-roberta-base` (named by the model config) is fetched at a pinned
  revision, tokenizer and config files only;
- the embedding resize in the model's __init__ is made non-mean (transformers 5
  cannot do the mean variant on the meta device);
- the output class is made a dataclass after import (transformers 5 requires it).
"""
import dataclasses
import shutil
import sys
import tempfile
from pathlib import Path

import torch
from huggingface_hub import snapshot_download
from transformers import AutoConfig, AutoTokenizer

from punct_bench.arm_protocol import main

REPO = "dragonSwing/xlm-roberta-capu"
REVISION = "3d9ce1f15ea9b57569088f8e94f7a7b80dd27bbe"
BASE_MODEL = "xlm-roberta-base"
BASE_REVISION = "e73636d4f797dec63c3081bb6ed5c7b0bb3f2089"


def _pin_base_model() -> None:
    """The model code calls `from_pretrained("xlm-roberta-base")` with no revision."""
    for auto in (AutoConfig, AutoTokenizer):
        original = auto.from_pretrained

        def pinned(name, *args, _original=original, **kwargs):
            if name == BASE_MODEL:
                kwargs.setdefault("revision", BASE_REVISION)
            return _original(name, *args, **kwargs)

        auto.from_pretrained = pinned


def _plain_embedding_resize() -> None:
    """transformers 5 builds the model on the meta device, where the mean-resizing it
    now defaults to in `resize_token_embeddings` (the model's __init__ adds the `$START`
    row) cannot run. Plain resizing is the behaviour the repo was written for, and the
    new row is overwritten when the checkpoint loads."""
    from transformers import PreTrainedModel

    original = PreTrainedModel.resize_token_embeddings

    def resize(self, new_num_tokens=None, pad_to_multiple_of=None, mean_resizing=False):
        return original(self, new_num_tokens, pad_to_multiple_of, mean_resizing)

    PreTrainedModel.resize_token_embeddings = resize


def load(variant: str, threads: int):
    torch.set_num_threads(threads)
    snapshot = Path(snapshot_download(REPO, revision=REVISION))
    code_dir = Path(tempfile.mkdtemp(prefix="xlmr-capu-"))
    for name in ("gec_model.py", "modeling_seq2labels.py", "configuration_seq2labels.py", "utils.py", "vocabulary.py", "verb-form-vocab.txt"):
        shutil.copy(snapshot / name, code_dir / name)
    shutil.copytree(snapshot / "vocabulary", code_dir / "vocabulary", ignore=shutil.ignore_patterns(".lock"))
    sys.path.insert(0, str(code_dir))
    _pin_base_model()
    _plain_embedding_resize()
    from gec_model import GecBERTModel  # noqa: E402  (the repo's own file)
    import modeling_seq2labels  # noqa: E402

    # transformers 5 insists a ModelOutput subclass carries @dataclass; the repo predates that.
    modeling_seq2labels.Seq2LabelsOutput = dataclasses.dataclass(modeling_seq2labels.Seq2LabelsOutput)

    model = GecBERTModel(
        vocab_path=str(code_dir / "vocabulary"),
        model_paths=str(snapshot),
        device="cpu",
        split_chunk=True,
    )
    shutil.rmtree(code_dir, ignore_errors=True)  # modules are already imported
    return lambda text: model(text)[0]


if __name__ == "__main__":
    main(load)
