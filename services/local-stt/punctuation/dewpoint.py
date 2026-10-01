# Vendored unchanged from https://huggingface.co/valkayuh/dewpoint (MIT),
# revision 4c45df7c148d096df50c8fbf47a9b0e34f08da68. Kept byte-for-byte below
# this header so a diff against upstream is the whole review; the Chatofy
# wrapper is punctuation/restorer.py.

"""Dewpoint: multilingual punctuation restoration and truecasing.

Self-contained inference for the released checkpoints, in one file, with two
interchangeable backends:

    from dewpoint import Punctuator
    p = Punctuator.from_pretrained("valkayuh/dewpoint")
    p.restore("so i said meet at three thirty tuesday what do you think", lang="en")
    # -> 'So I said meet at three thirty Tuesday. What do you think?'

backend="torch"  needs torch + transformers + safetensors, and uses a GPU if present.
backend="onnx"   needs only onnxruntime + tokenizers + numpy (no torch at all),
                 and downloads the ONNX graphs instead of the safetensors.
backend="auto"   (the default) uses torch when it is installed, otherwise ONNX.

The model is an ensemble of two dual-head token taggers (mmBERT-base and
XLM-RoBERTa-large).  Each member reads the same word list and returns one
posterior per word; the posteriors are averaged in probability space, a
per-class decision bias fitted on IWSLT dev2010 is applied, and the argmax is
taken.  Pass ``members=["mmbert-base"]`` for the single 307M-parameter model,
which uses its own calibration.

It is a tagger, not a generator: it never adds, drops, reorders or rewrites a
word.  It only decides, per word, which mark follows it (none / , / . / ? / !)
and how it is cased (lower / Capitalised / UPPER).
"""
from __future__ import annotations

import json
import os
import re
import unicodedata
from typing import Iterable, Sequence

import numpy as np

try:                              # torch is optional: the ONNX backend needs none
    import torch
    import torch.nn as nn
except ImportError:               # pragma: no cover
    torch = None
    nn = None

__all__ = ["Punctuator", "StreamingPunctuator"]

PUNCT_LABELS = ["O", "COMMA", "PERIOD", "QUESTION", "EXCLAM"]
CASE_LABELS = ["LOWER", "CAP", "UPPER"]
_SENT_END = {"PERIOD", "QUESTION", "EXCLAM"}

# ------------------------------------------------------------ language rules
# Scripts with no case distinction: the case head is masked to LOWER.
CASELESS_LANGS = {
    "zh", "zh-cn", "zh-tw", "ja", "ko", "ar", "he", "fa", "ur", "th", "hi", "bn",
    "ta", "te", "ml", "kn", "mr", "gu", "pa", "ne", "si", "my", "km", "lo", "am",
    "ti", "dv", "bo", "dz", "ps", "sd", "ug", "yi", "yue", "wuu", "as", "or",
    "arq", "arz", "ary", "acm", "apc", "ckb", "ka", "he-il", "sa", "ks", "bho",
}
# Written without spaces between words: one grapheme cluster is one token.
NO_SPACE_LANGS = {"zh", "zh-cn", "zh-tw", "ja", "th", "my", "km", "lo", "bo",
                  "dz", "yue", "wuu"}

_SURFACE = {
    "ascii": {"O": "", "COMMA": ",", "PERIOD": ".", "QUESTION": "?", "EXCLAM": "!"},
    "cjk": {"O": "", "COMMA": "，", "PERIOD": "。", "QUESTION": "？", "EXCLAM": "！"},
    "ja": {"O": "", "COMMA": "、", "PERIOD": "。", "QUESTION": "？", "EXCLAM": "！"},
    "arab": {"O": "", "COMMA": "،", "PERIOD": ".", "QUESTION": "؟", "EXCLAM": "!"},
    "deva": {"O": "", "COMMA": ",", "PERIOD": "।", "QUESTION": "?", "EXCLAM": "!"},
    # Greek writes its question mark with the ASCII semicolon.
    "el": {"O": "", "COMMA": ",", "PERIOD": ".", "QUESTION": ";", "EXCLAM": "!"},
    "hy": {"O": "", "COMMA": ",", "PERIOD": "։", "QUESTION": "՞", "EXCLAM": "՜"},
}
_SURFACE_BY_LANG = {}
for _l in ("zh", "zh-cn", "zh-tw", "yue", "wuu"):
    _SURFACE_BY_LANG[_l] = _SURFACE["cjk"]
for _l in ("ar", "fa", "ur", "ps", "arq", "arz", "ary", "ckb", "sd", "ug"):
    _SURFACE_BY_LANG[_l] = _SURFACE["arab"]
for _l in ("hi", "bn", "mr", "ne", "pa", "as", "or", "sa", "bho"):
    _SURFACE_BY_LANG[_l] = _SURFACE["deva"]
_SURFACE_BY_LANG.update(el=_SURFACE["el"], hy=_SURFACE["hy"], ja=_SURFACE["ja"])

# Characters stripped from the edges of an input token before tagging, so text
# that already carries some punctuation is handled the same as bare ASR output.
_MARKS = set(
    ".。．۔।॥။։។…⋯።,，،٫၊、᠂᠈፣?？؟;՞⸮፧!！՜:：；؛·-–—―−፡"
    "\"'‘’“”„‚«»()[]{}〈〉《》「」『』（）‹›‟″′¡¿⸘‛*_`•⁃・＂＇´‐‑"
)
_LATIN_RUN = re.compile(r"[A-Za-z0-9À-ɏ]+(?:[.'’-][A-Za-z0-9]+)*")


def base_lang(lang: str) -> str:
    return lang.split("-")[0].lower()


def is_caseless(lang: str) -> bool:
    return lang.lower() in CASELESS_LANGS or base_lang(lang) in CASELESS_LANGS


def is_no_space(lang: str) -> bool:
    return lang.lower() in NO_SPACE_LANGS or base_lang(lang) in NO_SPACE_LANGS


def surface_for(lang: str) -> dict:
    return _SURFACE_BY_LANG.get(base_lang(lang), _SURFACE["ascii"])


def apply_case(word: str, case: str) -> str:
    if case == "UPPER":
        return word.upper()
    if case == "CAP":
        return word[:1].upper() + word[1:]
    return word


def split_words(text: str, lang: str) -> list[str]:
    """Raw text -> the lowercased, mark-free word list the model was trained on."""
    text = unicodedata.normalize("NFC", text)
    if is_no_space(lang):
        return _split_charwise(text)
    out = []
    for raw in text.split():
        chars = [i for i, ch in enumerate(raw) if ch not in _MARKS]
        if not chars:
            continue
        core = raw[chars[0]:chars[-1] + 1]
        if any(ch.isalnum() for ch in core):
            out.append(core.lower())
    return out


def _split_charwise(text: str) -> list[str]:
    """CJK / Thai / Khmer: grapheme clusters, with Latin runs kept whole."""
    words, i, n = [], 0, len(text)
    while i < n:
        ch = text[i]
        if ch.isspace() or ch in _MARKS:
            i += 1
            continue
        m = _LATIN_RUN.match(text, i)
        if m and m.group():
            words.append(m.group().lower())
            i = m.end()
            continue
        if ch.isalnum() or unicodedata.category(ch) in ("Mn", "Mc", "Me"):
            j = i + 1
            while j < n and unicodedata.category(text[j]) in ("Mn", "Mc", "Me"):
                j += 1
            words.append(text[i:j].lower())
            i = j
            continue
        i += 1
    return words


# ------------------------------------------------------------------- model
if torch is not None:
    class PunctCaseModel(nn.Module):
        """Encoder -> residual shared trunk -> punctuation head and case head."""

        def __init__(self, config, n_punct=5, n_case=3):
            super().__init__()
            from transformers import AutoModel
            self.encoder = AutoModel.from_config(config)
            h = config.hidden_size
            self.drop = nn.Dropout(0.1)
            self.trunk = nn.Sequential(nn.Linear(h, h), nn.GELU(),
                                       nn.LayerNorm(h, eps=1e-5))
            self.head_punct = nn.Linear(h, n_punct)
            self.head_case = nn.Linear(h, n_case)

        def forward(self, input_ids, attention_mask=None):
            x = self.encoder(input_ids=input_ids,
                             attention_mask=attention_mask).last_hidden_state
            x = self.drop(x)
            x = x + self.trunk(x)
            return self.head_punct(x), self.head_case(x)

    __all__.append("PunctCaseModel")


def plan_windows(sub_counts, max_sub=508, overlap_sub=256):
    """Overlapping windows under a subword budget; only each window's centre
    commits.  Returns (win_start, win_end, commit_start, commit_end) in words."""
    n = len(sub_counts)
    if n == 0:
        return []
    overlap_sub = min(overlap_sub, max_sub // 2)
    prefix = [0] * (n + 1)
    for i, c in enumerate(sub_counts):
        prefix[i + 1] = prefix[i] + max(1, c)

    def end_for(start):
        lo, hi = start + 1, n
        budget = prefix[start] + max_sub
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if prefix[mid] <= budget:
                lo = mid
            else:
                hi = mid - 1
        return max(lo, start + 1)

    wins, start = [], 0
    while True:
        end = end_for(start)
        wins.append([start, end])
        if end >= n:
            break
        target = prefix[end] - overlap_sub
        nxt = end
        while nxt > start + 1 and prefix[nxt] > target:
            nxt -= 1
        start = max(nxt, start + 1)
    out = []
    for i, (s, e) in enumerate(wins):
        cs = s if i == 0 else (wins[i - 1][1] + s) // 2
        ce = e if i == len(wins) - 1 else (e + wins[i + 1][0] + 1) // 2
        cs = max(cs, s)
        out.append((s, e, cs, min(max(ce, cs), e)))
    return out


class _MemberBase:
    """Windowing, first-subword gathering and caseless masking, shared by both
    backends so that they cannot drift apart.  Subclasses supply `_counts`
    (subwords per word), `_encode` (a padded batch plus word ids) and
    `_forward` (softmaxed posteriors as numpy)."""

    def _load_meta(self, path):
        with open(os.path.join(path, "vpunct_config.json"), encoding="utf-8") as f:
            self.meta = json.load(f)
        self.max_len = int(self.meta.get("max_len", 512))

    def posteriors(self, words, lang):
        n = len(words)
        pp = np.zeros((n, len(PUNCT_LABELS)), dtype=np.float32)
        pp[:, 0] = 1.0
        cp = np.zeros((n, len(CASE_LABELS)), dtype=np.float32)
        cp[:, 0] = 1.0
        if n == 0:
            return pp, cp
        wins = plan_windows(self._counts(list(words)), max_sub=self.max_len - 4,
                            overlap_sub=256)
        for i in range(0, len(wins), self.batch_size):
            chunk = wins[i:i + self.batch_size]
            ids, mask, wids = self._encode([list(words[s:e]) for s, e, _, _ in chunk])
            p, c = self._forward(ids, mask)
            for b, (s, e, cs, ce) in enumerate(chunk):
                loc_p = np.zeros((e - s, len(PUNCT_LABELS)), dtype=np.float32)
                loc_p[:, 0] = 1.0
                loc_c = np.zeros((e - s, len(CASE_LABELS)), dtype=np.float32)
                loc_c[:, 0] = 1.0
                seen = set()
                for pos, w in enumerate(wids[b]):
                    if w is None or w in seen or pos >= p.shape[1]:
                        continue
                    seen.add(w)          # label lives on a word's first subword
                    loc_p[w] = p[b, pos]
                    loc_c[w] = c[b, pos]
                pp[cs:ce] = loc_p[cs - s:ce - s]
                cp[cs:ce] = loc_c[cs - s:ce - s]
        if is_caseless(lang):
            cp[:] = 0.0
            cp[:, 0] = 1.0
        return pp, cp


def _softmax(x):
    x = x - x.max(-1, keepdims=True)
    e = np.exp(x)
    return e / e.sum(-1, keepdims=True)


class _TorchMember(_MemberBase):
    """One tagger run by torch, from its safetensors."""

    def __init__(self, path, device, dtype, batch_size=64):
        from safetensors.torch import load_file
        from transformers import AutoConfig, AutoTokenizer
        self._load_meta(path)
        cfg = AutoConfig.from_pretrained(path)
        model = PunctCaseModel(cfg, self.meta["n_punct"], self.meta["n_case"])
        model.load_state_dict(load_file(os.path.join(path, "model.safetensors")))
        self.model = model.to(device=device, dtype=dtype).eval()
        try:
            self.model.encoder.config._attn_implementation = "sdpa"
        except Exception:
            pass
        self.tok = AutoTokenizer.from_pretrained(path)
        self.device = device
        self.batch_size = batch_size

    def _counts(self, words):
        return [len(e) for e in self.tok(words, add_special_tokens=False)["input_ids"]]

    def _encode(self, batch):
        enc = self.tok(batch, is_split_into_words=True, truncation=True,
                       max_length=self.max_len, padding=True, return_tensors="pt")
        return enc["input_ids"], enc["attention_mask"], \
            [enc.word_ids(b) for b in range(len(batch))]

    def _forward(self, ids, mask):
        with torch.no_grad():
            lp, lc = self.model(ids.to(self.device), mask.to(self.device))
        return (lp.float().softmax(-1).cpu().numpy(),
                lc.float().softmax(-1).cpu().numpy())


class _OnnxMember(_MemberBase):
    """One tagger run by onnxruntime, tokenised by the `tokenizers` library.
    No torch and no transformers anywhere on this path."""

    def __init__(self, path, onnx_dir, providers=None, batch_size=8, threads=None):
        import onnxruntime as ort
        from tokenizers import Tokenizer
        self._load_meta(path)
        self.tok = Tokenizer.from_file(os.path.join(path, "tokenizer.json"))
        self.tok.no_padding()
        # truncate the way transformers does: before the special tokens are
        # added, so an over-long window still ends in its closing token
        self.tok.enable_truncation(max_length=self.max_len)
        with open(os.path.join(path, "tokenizer_config.json"), encoding="utf-8") as f:
            tcfg = json.load(f)
        self.pad_id = self.tok.token_to_id(tcfg.get("pad_token", "<pad>")) or 0
        so = ort.SessionOptions()
        if threads:
            so.intra_op_num_threads = threads
        if providers is None:
            avail = ort.get_available_providers()
            providers = [p for p in ("CUDAExecutionProvider", "CoreMLExecutionProvider",
                                     "DmlExecutionProvider") if p in avail]
            providers.append("CPUExecutionProvider")
        self.sess = ort.InferenceSession(os.path.join(onnx_dir, "model.onnx"), so,
                                         providers=providers)
        self.batch_size = batch_size

    def _counts(self, words):
        return [len(e.ids) for e in
                self.tok.encode_batch(words, add_special_tokens=False)]

    def _encode(self, batch):
        encs = self.tok.encode_batch(batch, is_pretokenized=True)
        L = min(self.max_len, max(len(e.ids) for e in encs))
        ids = np.full((len(encs), L), self.pad_id, dtype=np.int64)
        mask = np.zeros((len(encs), L), dtype=np.int64)
        wids = []
        for b, e in enumerate(encs):
            n = min(L, len(e.ids))
            ids[b, :n] = e.ids[:n]
            mask[b, :n] = 1
            wids.append(list(e.word_ids[:n]))
        return ids, mask, wids

    def _forward(self, ids, mask):
        lp, lc = self.sess.run(None, {"input_ids": ids, "attention_mask": mask})
        return _softmax(lp.astype(np.float32)), _softmax(lc.astype(np.float32))


# -------------------------------------------------------------- public api
class Punctuator:
    """Restore punctuation and case in unpunctuated, lowercased text."""

    MEMBERS = ("mmbert-base", "xlm-roberta-large")

    def __init__(self, path, members=None, backend="auto", device=None, dtype=None,
                 use_gazetteer=True, batch_size=None, providers=None, threads=None):
        members = list(members or self.MEMBERS)
        self.backend = self._pick_backend(path, members, backend)
        if self.backend == "torch":
            if device is None:
                device = "cuda" if torch.cuda.is_available() else "cpu"
            if dtype is None:
                dtype = torch.bfloat16 if str(device).startswith("cuda") else torch.float32
            self.members = [_TorchMember(os.path.join(path, m), device, dtype,
                                         batch_size or 64) for m in members]
        else:
            self.members = [_OnnxMember(os.path.join(path, m),
                                        os.path.join(path, "onnx", m), providers,
                                        batch_size or 8, threads) for m in members]
        if len(members) == len(self.MEMBERS):
            # The ensemble is calibrated as its own system: each member's bias
            # describes its own posterior, not the average of two.
            with open(os.path.join(path, "ensemble_config.json"), encoding="utf-8") as f:
                ens = json.load(f)
            self.weights = ens["weights"]
            self.bias = ens["punct_bias"]
            self.bias_per_lang = ens["punct_bias_per_lang"]
        else:
            self.weights = [1.0 / len(members)] * len(members)
            meta = self.members[0].meta if len(members) == 1 else {}
            self.bias = meta.get("punct_bias")
            self.bias_per_lang = meta.get("punct_bias_per_lang") or {}
        gz = os.path.join(path, "gazetteer.json")
        self.gazetteer = {}
        if use_gazetteer and os.path.exists(gz):
            with open(gz, encoding="utf-8") as f:
                self.gazetteer = json.load(f)

    @staticmethod
    def _pick_backend(path, members, backend):
        if backend == "auto":
            has_st = all(os.path.exists(os.path.join(path, m, "model.safetensors"))
                         for m in members)
            backend = "torch" if (torch is not None and has_st) else "onnx"
        if backend == "torch" and torch is None:
            raise ImportError("backend='torch' needs torch; install it, or use "
                              "backend='onnx' (onnxruntime + tokenizers only)")
        if backend not in ("torch", "onnx"):
            raise ValueError("backend must be 'auto', 'torch' or 'onnx'")
        return backend

    @classmethod
    def from_pretrained(cls, repo_or_path="valkayuh/dewpoint", **kw):
        """A local directory, or a Hugging Face repo id to download.  Only the
        files the chosen backend needs are fetched: the ONNX backend never
        downloads the safetensors, and the torch backend never downloads ONNX."""
        if os.path.isdir(repo_or_path):
            return cls(repo_or_path, **kw)
        from huggingface_hub import snapshot_download
        members = kw.get("members") or cls.MEMBERS
        backend = kw.get("backend", "auto")
        if backend == "auto":
            backend = "torch" if torch is not None else "onnx"
            kw["backend"] = backend
        allow = ["dewpoint.py", "ensemble_config.json", "gazetteer.json"]
        for m in members:
            allow += [f"{m}/vpunct_config.json", f"{m}/tokenizer.json",
                      f"{m}/tokenizer_config.json"]
            allow += ([f"{m}/config.json", f"{m}/model.safetensors"]
                      if backend == "torch" else [f"onnx/{m}/*"])
        return cls(snapshot_download(repo_or_path, allow_patterns=allow), **kw)

    # ------------------------------------------------------------ core
    def _bias_for(self, lang):
        b = None
        if self.bias_per_lang:
            b = self.bias_per_lang.get(lang) or self.bias_per_lang.get(base_lang(lang))
        return b if b is not None else self.bias

    def predict(self, words: Sequence[str], lang: str = "en") -> dict:
        """Per-word labels and averaged posteriors for an already-split word list.

        ``words`` should be lowercased and free of punctuation, as ASR output is.
        """
        words = list(words)
        acc_p = acc_c = None
        for w, m in zip(self.weights, self.members):
            p, c = m.posteriors(words, lang)
            acc_p = w * p if acc_p is None else acc_p + w * p
            acc_c = w * c if acc_c is None else acc_c + w * c
        lp = np.log(np.clip(acc_p, 1e-9, None))
        b = self._bias_for(lang)
        if b is not None:
            lp = lp + np.asarray(b, dtype=np.float32)[None, :]
        punct = [PUNCT_LABELS[i] for i in lp.argmax(1)] if len(words) else []
        case = [CASE_LABELS[i] for i in acc_c.argmax(1)] if len(words) else []
        return {"words": words, "punct": punct, "case": case,
                "punct_probs": acc_p, "case_probs": acc_c, "punct_scores": lp}

    @staticmethod
    def _close(punct, scores):
        """A complete text ends on a sentence mark: if the last word got none,
        take the likeliest of . ? ! for it.  Applied to finished text only --
        predict() is left exactly as benchmarked."""
        if punct and punct[-1] not in _SENT_END:
            ends = [PUNCT_LABELS.index(x) for x in ("PERIOD", "QUESTION", "EXCLAM")]
            punct[-1] = PUNCT_LABELS[max(ends, key=lambda i: scores[-1][i])]
        return punct

    def _postprocess(self, words, punct, case, lang, is_start=True, prev_punct=None):
        """Gazetteer surface forms (iPhone, McDonald) and a capital after every
        sentence-final mark."""
        case = list(case)
        caseless = is_caseless(lang)
        gz = self.gazetteer.get(base_lang(lang), {})
        out = []
        for i, w in enumerate(words):
            s = gz.get(w)
            if s and not caseless:
                out.append(s)
                case[i] = "AS_IS"
            else:
                out.append(w)
        if not caseless and words:
            lead = prev_punct in _SENT_END if prev_punct is not None else False
            if case[0] == "LOWER" and (is_start or lead):
                case[0] = "CAP"
            for i in range(1, len(words)):
                if punct[i - 1] in _SENT_END and case[i] == "LOWER":
                    case[i] = "CAP"
        return out, list(punct), case

    def _render(self, words, punct, case, lang):
        surf = surface_for(lang)
        sep = "" if is_no_space(lang) else " "
        return sep.join((w if c == "AS_IS" else apply_case(w, c)) + surf.get(p, "")
                        for w, p, c in zip(words, punct, case))

    def restore(self, text: str, lang: str = "en", close: bool = True) -> str:
        """Unpunctuated text in, punctuated and truecased text out.

        ``close`` ends the text on a sentence mark; turn it off when ``text``
        is a fragment that continues elsewhere.
        """
        words = split_words(text, lang)
        if not words:
            return text
        r = self.predict(words, lang)
        punct = self._close(r["punct"], r["punct_scores"]) if close else r["punct"]
        w, p, c = self._postprocess(words, punct, r["case"], lang)
        return self._render(w, p, c, lang)

    def restore_batch(self, texts: Iterable[str], lang: str = "en") -> list[str]:
        return [self.restore(t, lang) for t in texts]

    def stream(self, lang="en", lag=6, context=180, stable_n=2):
        return StreamingPunctuator(self, lang, lag, context, stable_n)


class StreamingPunctuator:
    """Commit-with-lag for live transcripts.

    Later words change earlier decisions -- "what do you think" only becomes a
    question at its last word -- so a word is released only once it has
    ``lag`` words of right context and the same label for ``stable_n``
    consecutive updates.  Call ``push(words)`` as ASR emits, ``finish()`` at
    the end; each returns the newly committed text.
    """

    def __init__(self, punctuator, lang="en", lag=6, context=180, stable_n=2):
        self.p, self.lang = punctuator, lang
        self.lag, self.context, self.stable_n = lag, context, stable_n
        self.words, self.emitted = [], 0
        self._last, self._streak = {}, {}

    def push(self, new_words) -> str:
        if isinstance(new_words, str):
            new_words = split_words(new_words, self.lang)
        self.words.extend(w.lower() for w in new_words)
        return self._commit(final=False)

    def finish(self) -> str:
        return self._commit(final=True)

    def _commit(self, final):
        if not self.words:
            return ""
        off = max(0, len(self.words) - self.context)
        r = self.p.predict(self.words[off:], self.lang)
        punct, case = r["punct"], r["case"]
        if final:
            punct = self.p._close(punct, r["punct_scores"])
        limit = len(self.words) if final else len(self.words) - self.lag
        done, i = [], self.emitted
        while i < limit:
            j = i - off
            if j < 0:
                i += 1
                continue
            if not final:
                lab = (punct[j], case[j])
                if self._last.get(i) == lab:
                    self._streak[i] = self._streak.get(i, 1) + 1
                else:
                    self._last[i], self._streak[i] = lab, 1
                if self._streak[i] < self.stable_n:
                    break
            done.append(i)
            i += 1
        if not done:
            return ""
        s, e = done[0], done[-1] + 1
        prev = punct[s - off - 1] if s - off - 1 >= 0 else None
        w, p, c = self.p._postprocess(self.words[s:e], punct[s - off:e - off],
                                      case[s - off:e - off], self.lang,
                                      is_start=(s == 0), prev_punct=prev)
        self.emitted = e
        out = self.p._render(w, p, c, self.lang)
        return out if s == 0 or is_no_space(self.lang) else " " + out


if __name__ == "__main__":
    import argparse
    import sys
    ap = argparse.ArgumentParser(description="Restore punctuation and case.")
    ap.add_argument("text", nargs="*", help="text to restore (default: stdin)")
    ap.add_argument("--lang", default="en", help="ISO 639-1 code, e.g. en, de, zh")
    ap.add_argument("--model", default=os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--single", action="store_true",
                    help="use only the mmBERT-base member (307M, faster)")
    ap.add_argument("--backend", default="auto", choices=["auto", "torch", "onnx"])
    a = ap.parse_args()
    p = Punctuator.from_pretrained(a.model, backend=a.backend,
                                   members=["mmbert-base"] if a.single else None)
    src = [" ".join(a.text)] if a.text else sys.stdin.read().splitlines()
    for line in src:
        print(p.restore(line, a.lang))
