"""Vietnamese STT — hynt/Zipformer-30M-RNNT-6000h via sherpa-onnx (INT8 ONNX).

Measured on this machine: 5.38% WER, RTF 0.017, p95 0.09s, 223MB peak RAM. See
docs/development-journey.md. Those numbers still describe an ordinary turn: the
decoder below them is unchanged, and a second one exists beside it only for a
turn that named terms to bias towards.

LICENSE: CC-BY-NC-ND-4.0 — academic / thesis use only, no commercial use.
Swap path if that changes: PhoWhisper behind the same SttProvider contract.
"""
import tempfile
from pathlib import Path

from .base import MODELS_DIR, SttEngine

MODEL_DIR = MODELS_DIR / "zipformer-vi-30m"
ENCODER = "encoder-epoch-20-avg-10.int8.onnx"
DECODER = "decoder-epoch-20-avg-10.int8.onnx"
JOINER = "joiner-epoch-20-avg-10.int8.onnx"

#: Decoding method for an ordinary turn.
#:
#: Unchanged, and deliberately so. `docs/development-journey.md` 3.10 measured
#: all three arms on the 50-utterance VIVOS set and recorded the decision to stay
#: here: beam search left WER at exactly 5.38, made CER 0.04 worse, and cost
#: 1.31x the RTF. Nothing below reopens that — a turn that names no term still
#: decodes exactly as it did.
DECODING_METHOD = "greedy_search"

#: Decoding method for a turn that named terms to bias towards.
#:
#: Contextual biasing cannot be added to greedy decoding: hotwords are scored
#: against beams, and a decoder keeping one path has nowhere to apply them. So a
#: biased turn is a different decoder, not a different argument.
#:
#: What the VIVOS measurement could not see is why this arm exists: that set is
#: read speech with no code-switching, so the failure it is aimed at cannot occur
#: in it. On a real conversation, biasing turned "giải quốc cơ" back into "giải
#: poker" and "siêu thị ta ghét" into "siêu thị target" — words whose loss
#: changed what the sentence meant while barely moving WER.
BIASED_DECODING_METHOD = "modified_beam_search"

#: How hard a hotword pulls the beam towards itself.
#:
#: Measured band rather than a guess. At 1.5 the terms land and the sentence
#: around them survives. At 3.0 the pull is strong enough to damage neighbours:
#: the multi-word entry "FIRST IN FIRST OUT" truncated the clause it sat in.
#:
#: The pull also reaches the words NEXT to the term: at 1.5 a list naming
#: "TARGET" but not the "SEARCH" beside it landed the first and broke the second
#: into "SH". So a caller's list is better for covering the English around a
#: term than for naming the term alone — which is a note for whoever writes the
#: glossary, not a knob to raise.
HOTWORDS_SCORE = 1.5

#: Name of the vocabulary sherpa-onnx maps hotwords onto model tokens through:
#: the SentencePiece pieces with their scores, a different file from the
#: "SYMBOL ID" token table the recognizer itself reads.
BPE_VOCAB = "bpe.vocab"


def ensure_bpe_vocab(model_dir: Path = MODEL_DIR) -> Path:
    """Write the piece/score vocabulary biasing needs, and return where it is.

    Generated rather than downloaded, for the same reason `tokens.txt` is: the
    upstream repository ships only `bpe.model`.

    Written to a temporary directory rather than beside the weights, and that is
    not a tidiness choice: `docker-compose.prod.yml` bind-mounts the model
    directory `:ro`, so a write there is an `OSError` at load and the sidecar
    never reaches /healthz. Regenerating on each start costs a few milliseconds
    for 2,000 pieces, which is cheaper than a second place the file can be
    missing from.
    """
    vocab_path = Path(tempfile.gettempdir()) / f"{model_dir.name}.{BPE_VOCAB}"
    if vocab_path.exists():
        return vocab_path

    import sentencepiece as spm

    sp = spm.SentencePieceProcessor()
    sp.load(str(model_dir / "bpe.model"))
    with open(vocab_path, "w", encoding="utf-8") as f:
        for piece_id in range(sp.get_piece_size()):
            f.write(f"{sp.id_to_piece(piece_id)} {sp.get_score(piece_id)}\n")
    return vocab_path


class ZipformerVi(SttEngine):
    lang = "vi"
    supports_hotwords = True

    def __init__(self) -> None:
        super().__init__()
        self._biased_recognizer = None

    def load(self) -> None:
        import sherpa_onnx

        def build(method: str, **biasing):
            # tokens.txt is generated from bpe.model by scripts/download_models.py
            # (the HF repo ships only the SentencePiece model).
            return sherpa_onnx.OfflineRecognizer.from_transducer(
                encoder=str(MODEL_DIR / ENCODER),
                decoder=str(MODEL_DIR / DECODER),
                joiner=str(MODEL_DIR / JOINER),
                tokens=str(MODEL_DIR / "tokens.txt"),
                num_threads=self._threads,
                decoding_method=method,
                **biasing,
            )

        self._recognizer = build(DECODING_METHOD)
        # A SECOND recognizer over the same weights rather than one recognizer
        # reconfigured per request: sherpa-onnx fixes the decoding method at
        # construction. It costs another copy of the model in memory, which is
        # what buys the guarantee that a conversation naming no term pays nothing
        # at all — neither the beam's RTF nor a decoder it was measured not to
        # need.
        #
        # The score sits here while the terms arrive per stream: how hard a
        # hotword pulls is a property of this model, which terms to pull towards
        # is a property of the conversation.
        self._biased_recognizer = build(
            BIASED_DECODING_METHOD,
            hotwords_score=HOTWORDS_SCORE,
            modeling_unit="bpe",
            bpe_vocab=str(ensure_bpe_vocab()),
        )

    @property
    def loaded(self) -> bool:
        # Both, so /healthz cannot report ready while the biased path would fail
        # the first turn that asks for it.
        return self._recognizer is not None and self._biased_recognizer is not None

    def recognizer_for(self, hotwords: str):
        return self._biased_recognizer if hotwords else self._recognizer

    def postprocess(self, text: str) -> str:
        """Convert the decoder's bare uppercase output to sentence case.

        This model emits "XIN CHÀO HÔM NAY TRỜI RẤT ĐẸP" — all caps, no
        punctuation. The transcript is shown to the user next to the English
        one from Parakeet, which is already sentence-cased and punctuated, so
        leaving it shouting looks broken.

        Proper nouns stay lowercased ("tôi đi hà nội") — recovering them needs
        a casing/punctuation restoration model, which is out of scope here.
        Python's case mapping handles Vietnamese diacritics correctly.
        """
        text = text.strip().lower()
        return text[:1].upper() + text[1:]
