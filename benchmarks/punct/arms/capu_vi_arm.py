"""capu-vi (leducminhnhat/capu-vi): fairseq EnViBERT + 4-layer BiGRU + CRF tagger, VLSP checkpoint.

Runs in its own environment, arms/capu_vi_env (Python 3.10, fairseq 0.12.2, CPU
torch 2.5): fairseq does not import on the harness's Python 3.11. License: the
repo declares none (no card, no LICENSE file); the training data is VLSP.
Pinned to REVISION.

Reference procedure is the repo's infer.py: `load_model()` builds the task and
loads model-bin/vlsp/checkpoint_best.pt, `infer([text], ...)` tags every word
with one label of {L,T,U}x{$,",",".","?"} (lower / Capitalized / UPPER, plus a mark
appended to the word; CRF Viterbi decode), and the `__main__` loop chunks long
input: more than 1.5 * 15 words is cut into 15-word windows advancing 7 words
(the last window takes the leftovers), each window is tagged on its own and
windows are merged by dropping `(15 - 7) // 2 = 4` words from each side of the
overlap (`overlap_cut`, `merging`, copied below; they are nested inside
`if __name__ == "__main__"` in infer.py so they cannot be imported). Shorter
input is tagged whole. No iterations, no thresholds: the decode is Viterbi.

The tagger only sets case and appends `, . ?` to words, so words are never
rewritten. `str.capitalize()` lowercases the rest of the word, and `$`/`L`
leave it as is.

Changes from the repo's files, all so it runs on CPU (the reference hard-codes
CUDA); the label decode is untouched:
- infer.py: `use_cuda = True` becomes False; `from seqeval.metrics import ...`
  (metrics unused at inference) is stubbed; `sys.argv` is reset to the program
  name while fairseq parses the flags `load_model` appends.
- utils.py: `load_pretrain_lm` wraps the flat `bpe` / `sentencepiece_vocab` args as the
  `cfg.bpe` object fairseq 0.12's RobertaHubInterface reads (the repo predates that);
  without it the BPE model path is unset.
- plugin/models/bert_crf.py: `features.to(align_matrix.dtype).cuda()` loses its `.cuda()`, and
  `encoder.extract_features(x)` becomes `encoder(x, features_only=True)` (fairseq 0.12 renamed
  what 0.9's RobertaModel.extract_features did), both in `forward` and `encode`.
Both are applied to a temp copy of the pinned snapshot.
"""
import os
import shutil
import sys
import tempfile
import types
from pathlib import Path

from huggingface_hub import snapshot_download

from punct_bench.arm_protocol import main

REPO = "leducminhnhat/capu-vi"
REVISION = "01e3579ae8c0828a6a579030b29c8a55df69b835"
CHUNK_SIZE = 15
OVERLAP_SIZE = int(CHUNK_SIZE / 2)


def _stage_cpu_copy(snapshot: Path) -> Path:
    """Copy the code of the snapshot into a temp dir and patch out the CUDA calls."""
    code = Path(tempfile.mkdtemp(prefix="capu-vi-"))
    shutil.copy(snapshot / "infer.py", code / "infer.py")
    utils = (snapshot / "utils.py").read_text(encoding="utf-8")
    assert "'sentencepiece_vocab'" in utils
    hub = "    trained_lm: XLMRModel = RobertaHubInterface(x['args'], x['task'], x['models'][0])"
    assert utils.count(hub) == 1
    # fairseq 0.12's RobertaHubInterface reads the BPE model from `cfg.bpe`, a config object;
    # the repo hands it the flat 0.9-style args, whose `bpe` is just the string 'sentencepiece'
    # (so the model path stays unset). Wrap the two flat attributes it needs.
    wrapped = (
        "    import argparse\n"
        "    x['args'].bpe = argparse.Namespace(bpe='sentencepiece', sentencepiece_model=x['args'].sentencepiece_vocab)\n"
    )
    # `trained_lm.args` (read by the plugin's build_model) is `.cfg` in 0.12; hand it the flat args.
    keep_args = "\n    trained_lm.args = x['args']"
    (code / "utils.py").write_text(utils.replace(hub, wrapped + hub + keep_args), encoding="utf-8")
    shutil.copytree(snapshot / "plugin", code / "plugin", ignore=shutil.ignore_patterns("__pycache__", ".DS_Store"))
    infer = (code / "infer.py").read_text(encoding="utf-8")
    assert "use_cuda = True" in infer
    infer = infer.replace("use_cuda = True", "use_cuda = False")
    (code / "infer.py").write_text(infer, encoding="utf-8")
    bert_crf = code / "plugin" / "models" / "bert_crf.py"
    source = bert_crf.read_text(encoding="utf-8")
    live = "features.to(align_matrix.dtype).cuda()"
    assert source.count(live) == 2  # forward() and encode(); commented-out .cuda() calls stay
    source = source.replace(live, "features.to(align_matrix.dtype)")
    # fairseq 0.12's RobertaModel.extract_features is plain forward() (LM head included, 59993-wide
    # logits); 0.9's returned the encoder features. `features_only=True` is the same thing.
    feats = "self.encoder.extract_features(src_tokens, **kwargs)[0]"
    assert source.count(feats) == 2
    bert_crf.write_text(source.replace(feats, "self.encoder(src_tokens, features_only=True, **kwargs)[0]"), encoding="utf-8")
    return code


def _overlap_cut(sentence: str):  # infer.py, __main__ block
    list_word = sentence.split(" ")
    start_index = 0
    sub_sentences = []
    overlap_time = 0
    if len(list_word[start_index : start_index + CHUNK_SIZE]) >= CHUNK_SIZE:
        while len(list_word[start_index : start_index + CHUNK_SIZE]) >= CHUNK_SIZE:
            overlap_time += 1
            sub_sentences.append(" ".join(list_word[start_index : start_index + CHUNK_SIZE]))
            start_index += OVERLAP_SIZE
        all_len = len(" ".join(sub_sentences).split())
        list_word_used = all_len - (overlap_time - 1) * (CHUNK_SIZE - OVERLAP_SIZE)
        words_left_over = len(list_word) - list_word_used
        if words_left_over != 0:
            sub_sentences[-1] += " " + " ".join(list_word[list_word_used : len(list_word)])
        return sub_sentences
    return sentence


def _merging(head_sentence: str, sub_sentence: str) -> str:  # infer.py, __main__ block
    min_words_cut = int((CHUNK_SIZE - OVERLAP_SIZE) / 2)
    sentence = head_sentence.strip().split()[:-min_words_cut] + sub_sentence.strip().split()[min_words_cut:]
    return " ".join(sentence)


def load(variant: str, threads: int):
    import torch

    torch.set_num_threads(threads)
    snapshot = Path(
        snapshot_download(
            REPO,
            revision=REVISION,
            allow_patterns=["*.py", "model-bin/vlsp/*", "model-bin/vlsp/dict/*"],
        )
    )
    code = _stage_cpu_copy(snapshot)
    sys.modules.setdefault("seqeval", types.ModuleType("seqeval"))
    metrics = types.ModuleType("seqeval.metrics")
    metrics.f1_score = metrics.classification_report = None
    sys.modules["seqeval.metrics"] = metrics

    here, argv = os.getcwd(), sys.argv
    os.chdir(code)  # the repo addresses ./plugin relative to itself
    sys.path.insert(0, str(code))
    try:
        import infer as reference

        reference.model_path = str(snapshot / "model-bin" / "vlsp") + "/"
        sys.argv = argv[:1]
        task, model, use_cuda = reference.load_model()
    finally:
        sys.argv = argv
        os.chdir(here)
        shutil.rmtree(code, ignore_errors=True)  # everything it holds is imported by now

    def tag(text: str) -> str:
        results, _ = reference.infer([text], task, model, use_cuda)
        return " ".join(results[0])

    def restore(text: str) -> str:
        text = text.strip()
        with torch.inference_mode():
            overlap = _overlap_cut(text) if len(text.split()) > 1.5 * CHUNK_SIZE else text
            if isinstance(overlap, str):
                return tag(overlap)
            merged = [tag(sentence.strip()) for sentence in overlap if sentence.strip()]
            full = merged[0]
            for part in merged[1:]:
                full = _merging(full, part)
            return full

    return restore


if __name__ == "__main__":
    main(load)
