"""ViBERT-capu (dragonSwing/vibert-capu) through the welcomyou ONNX port.

Variants: int8 (vibert-capu.int8.onnx, dynamic-quantized), fp32 (vibert-capu.onnx).
License: cc-by-sa-4.0. Weights + reference code are pinned to REVISION.

The model is a GECToR seq2labels tagger: one of 15 edit actions per word,
including a leading `$START` position. The reference decode is
`GecBERTModel` in the repo's gec_model.py, with the settings of the
dragonSwing card (`GecBERTModel(..., split_chunk=True)`, everything else at
its default). That class imports torch, so its decode is ported here to numpy
line for line and the ONNX graph replaces `Seq2LabelsModel.forward`:

- tokens: `.split()` words, cased (lowercase_tokens=False), `$START` prepended
  and tokenized as an added token (gec_model.py `_get_indexer`, `preprocess`);
  `input_offsets` = index of the first sub-token of each word.
- probabilities: softmax over the 15 logits, argmax per word (`_convert`).
- `$KEEP` and `@@UNKNOWN@@`/`@@PADDING@@` are no edits; `prob <
  min_error_probability` (0.0) never filters; `confidence` is an __init__
  argument the class never reads, so there is no keep boost.
- up to 3 iterations (`iterations=3`): the edited tokens are re-tagged until
  a pass changes nothing or yields an already-seen result
  (`handle_batch`, `update_final_batch`).
- inputs shorter than 3 words (`min_len`) are returned untouched.
- long input is cut into 48-word chunks overlapping by 12 and merged back by
  a SequenceMatcher alignment of the overlap (`split_chunks`,
  `apply_chunk_merging`, `merge_chunks`).
- appended marks are separate tokens joined back with
  `re.sub(r'\\s+([\\:\\.\\,\\?])', r'\\1')` (`handle_batch` merge_punc).
- edits are applied by the repo's own utils.py `get_target_sent_by_edits`,
  imported from the pinned snapshot.

Actions that change a word (not only case or a mark): `$TRANSFORM_VERB_VB_VBN` /
`_VBC` replace the word through verb-form-vocab.txt, which in this repo is a
Vietnamese number-word table (36,169 `word_digit:VB_VBN` lines such as `năm_5`,
`một_1`, `hai_2`), so "năm năm tới" can come out "5 năm tới"; a word absent from
the table is left unchanged. `$MERGE_SPACE` joins a word to the next one (the word
count drops). `$TRANSFORM_CASE_*` and `$APPEND_*` keep the word. The scorer flags
any word change itself.

One deliberate difference: chunks are run one at a time instead of padded
into a batch. Attention is masked, so the outputs are the same up to float
noise, and it keeps the timing per call honest.
"""
import re
import sys
import types
from difflib import SequenceMatcher

import numpy as np
import onnxruntime as ort
from huggingface_hub import snapshot_download
from tokenizers import Tokenizer, models, normalizers, pre_tokenizers

from punct_bench.arm_protocol import main

REPO = "welcomyou/vibert-capu-onnx"
REVISION = "a7754d037f4a9e29f7f3224f27acb60149eab874"
_FILES = {"int8": "vibert-capu.int8.onnx", "fp32": "vibert-capu.onnx"}

# GecBERTModel defaults (gec_model.py:25-42), split_chunk=True per the card.
MAX_LEN, MIN_LEN, ITERATIONS, MIN_ERROR_PROBABILITY = 64, 3, 3, 0.0
CHUNK_SIZE, OVERLAP_SIZE, MIN_WORDS_CUT = 48, 12, 6
PUNC_DICT = {":", ".", ",", "?"}
PUNC_RE = "[" + "".join(f"\\{x}" for x in sorted(PUNC_DICT)) + "]"


def _import_utils(path: str):
    """The repo's utils.py, run from the snapshot dir. It finds verb-form-vocab.txt via
    `Path(__file__).resolve()`, which follows the HF cache symlink into blobs/ and
    misses it, so VOCAB_DIR is pinned to the snapshot dir."""
    source = open(f"{path}/utils.py", encoding="utf-8").read()
    source = source.replace("Path(__file__).resolve().parent", f"Path({path!r})")
    module = types.ModuleType("vibert_capu_utils")
    exec(compile(source, f"{path}/utils.py", "exec"), module.__dict__)
    return module


def _build_tokenizer(path: str, start_token: str) -> Tokenizer:
    """What AutoTokenizer gives for FPTAI/vibert-base-cased (a BERT WordPiece converted
    to a fast tokenizer, cased) plus `$START` added as a single token."""
    tokenizer = Tokenizer(models.WordPiece.from_file(f"{path}/vocab.txt", unk_token="[UNK]"))
    tokenizer.normalizer = normalizers.BertNormalizer(
        clean_text=True, handle_chinese_chars=True, strip_accents=None, lowercase=False
    )
    tokenizer.pre_tokenizer = pre_tokenizers.BertPreTokenizer()
    tokenizer.add_tokens([start_token])
    return tokenizer


class _Decoder:
    def __init__(self, path: str, onnx_file: str, threads: int):
        self.utils = _import_utils(path)
        self.labels = [line.strip() for line in open(f"{path}/vocabulary/labels.txt", encoding="utf-8") if line.strip()]
        self.noop_index = self.labels.index("$KEEP")
        detect = [line.strip() for line in open(f"{path}/vocabulary/d_tags.txt", encoding="utf-8") if line.strip()]
        self.incorr_index = detect.index("INCORRECT")
        self.tokenizer = _build_tokenizer(path, self.utils.START_TOKEN)
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        self.session = ort.InferenceSession(f"{path}/{onnx_file}", options, providers=["CPUExecutionProvider"])

    # -- model -------------------------------------------------------------
    def _predict(self, words: list[str]):
        """`preprocess` + `predict` + `_convert` for one sequence."""
        encoding = self.tokenizer.encode(
            [self.utils.START_TOKEN] + words[:MAX_LEN], is_pretokenized=True, add_special_tokens=False
        )
        word_ids = encoding.word_ids
        offsets = [0] + [i for i in range(1, len(word_ids)) if word_ids[i] != word_ids[i - 1]]
        n = len(encoding.ids)
        logits, detect_logits = self.session.run(
            None,
            {
                "input_ids": np.array([encoding.ids], dtype=np.int64),
                "attention_mask": np.ones((1, n), dtype=np.int64),
                "token_type_ids": np.zeros((1, n), dtype=np.int64),
                "input_offsets": np.array([offsets], dtype=np.int64),
            },
        )
        exp = np.exp(logits[0] - logits[0].max(-1, keepdims=True))
        probs = exp / exp.sum(-1, keepdims=True)
        d_exp = np.exp(detect_logits[0] - detect_logits[0].max(-1, keepdims=True))
        d_probs = d_exp / d_exp.sum(-1, keepdims=True)
        return probs.max(-1).tolist(), probs.argmax(-1).tolist(), float(d_probs[:, self.incorr_index].max())

    # -- gec_model.py ports --------------------------------------------------
    def _get_token_action(self, index, prob, sugg_token):
        if prob < MIN_ERROR_PROBABILITY or sugg_token in ["@@UNKNOWN@@", "@@PADDING@@", "$KEEP"]:
            return None
        if sugg_token.startswith("$REPLACE_") or sugg_token.startswith("$TRANSFORM_") or sugg_token == "$DELETE":
            start_pos, end_pos = index, index + 1
        elif sugg_token.startswith("$APPEND_") or sugg_token.startswith("$MERGE_"):
            start_pos, end_pos = index + 1, index + 1
        if sugg_token == "$DELETE":
            clear = ""
        elif sugg_token.startswith("$TRANSFORM_") or sugg_token.startswith("$MERGE_"):
            clear = sugg_token[:]
        else:
            clear = sugg_token[sugg_token.index("_") + 1 :]
        return start_pos - 1, end_pos - 1, clear, prob

    def _postprocess(self, tokens, probabilities, idxs, error_prob):
        length = min(len(tokens), MAX_LEN)
        if max(idxs) == 0 or error_prob < MIN_ERROR_PROBABILITY:
            return tokens
        edits = []
        for i in range(length + 1):
            if idxs[i] == self.noop_index:
                continue
            action = self._get_token_action(i, probabilities[i], self.labels[idxs[i]])
            if action:
                edits.append(action)
        return self.utils.get_target_sent_by_edits(tokens, edits)

    def _tag(self, chunks: list[list[str]]) -> list[list[str]]:
        """`handle_batch`'s iteration loop over a list of chunks."""
        final = chunks[:]
        prev_preds = {i: [final[i]] for i in range(len(final))}
        pred_ids = [i for i in range(len(final)) if len(final[i]) >= MIN_LEN]
        for _ in range(ITERATIONS):
            batch = [final[i] for i in pred_ids]
            if not batch:
                break
            pred_batch = [self._postprocess(tokens, *self._predict(tokens)) for tokens in batch]
            new_ids = []
            for i, orig_id in enumerate(pred_ids):  # update_final_batch
                orig, pred = final[orig_id], pred_batch[i]
                if orig != pred and pred not in prev_preds[orig_id]:
                    final[orig_id] = pred
                    new_ids.append(orig_id)
                    prev_preds[orig_id].append(pred)
                elif orig != pred:
                    final[orig_id] = pred
            pred_ids = new_ids
            if not pred_ids:
                break
        return final

    @staticmethod
    def _split_chunks(tokens):
        n = len(tokens)
        if n <= CHUNK_SIZE:
            return [tokens]
        if n < CHUNK_SIZE * 2 - OVERLAP_SIZE:
            split_idx = (n + OVERLAP_SIZE + 1) // 2
            return [tokens[:split_idx], tokens[split_idx - OVERLAP_SIZE :]]
        stride = CHUNK_SIZE - OVERLAP_SIZE
        return [tokens[i : i + CHUNK_SIZE] for i in range(0, n - OVERLAP_SIZE, stride)]

    @staticmethod
    def _apply_chunk_merging(tokens, next_tokens):
        if not tokens:
            return next_tokens
        source_idx, target_idx, source_tokens, target_tokens = [], [], [], []
        num_keep = OVERLAP_SIZE - MIN_WORDS_CUT
        i = 0
        while len(source_idx) < OVERLAP_SIZE and -i < len(tokens):
            i -= 1
            if tokens[i] not in PUNC_DICT:
                source_idx.insert(0, i)
                source_tokens.insert(0, tokens[i].lower())
        i = 0
        while len(target_idx) < OVERLAP_SIZE and i < len(next_tokens):
            if next_tokens[i] not in PUNC_DICT:
                target_idx.append(i)
                target_tokens.append(next_tokens[i].lower())
            i += 1
        for tag, i1, i2, j1, j2 in SequenceMatcher(None, source_tokens, target_tokens).get_opcodes():
            if tag == "equal":
                if i1 >= num_keep:
                    tail_idx, head_idx = source_idx[i1], target_idx[j1]
                    break
                elif i2 > num_keep:
                    tail_idx, head_idx = source_idx[num_keep], target_idx[j2 - i2 + num_keep]
                    break
            elif tag == "delete" and i1 == 0:
                num_keep += i2 // 2
        return tokens[:tail_idx] + next_tokens[head_idx:]

    def _merge_chunks(self, chunks):
        if len(chunks) == 1:
            return " ".join(chunks[0])
        result = []
        for sub_tokens in chunks:
            try:
                result = self._apply_chunk_merging(result, sub_tokens)
            except Exception as err:  # the reference prints and drops the chunk (merge_chunks)
                print(f"chunk merge failed: {err!r}", file=sys.stderr)
        return " ".join(result)

    def restore(self, text: str) -> str:
        chunks = self._tag(self._split_chunks(text.split()))
        return re.sub(r"\s+(%s)" % PUNC_RE, r"\1", self._merge_chunks(chunks))


def load(variant: str, threads: int):
    path = snapshot_download(
        REPO,
        revision=REVISION,
        allow_patterns=["*.py", "vocab.txt", "verb-form-vocab.txt", "vocabulary/*", _FILES[variant]],
    )
    return _Decoder(path, _FILES[variant], threads).restore


if __name__ == "__main__":
    main(load)
