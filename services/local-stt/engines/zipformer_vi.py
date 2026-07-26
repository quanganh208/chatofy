"""Vietnamese STT — hynt/Zipformer-30M-RNNT-6000h via sherpa-onnx (INT8 ONNX).

Measured on this machine: 5.38% WER, RTF 0.017, p95 0.09s, 223MB peak RAM.
See docs/development-journey.md.

LICENSE: CC-BY-NC-ND-4.0 — academic / thesis use only, no commercial use.
Swap path if that changes: PhoWhisper behind the same SttProvider contract.
"""
from .base import MODELS_DIR, SttEngine

MODEL_DIR = MODELS_DIR / "zipformer-vi-30m"
ENCODER = "encoder-epoch-20-avg-10.int8.onnx"
DECODER = "decoder-epoch-20-avg-10.int8.onnx"
JOINER = "joiner-epoch-20-avg-10.int8.onnx"


class ZipformerVi(SttEngine):
    lang = "vi"

    def load(self) -> None:
        import sherpa_onnx

        # tokens.txt is generated from bpe.model by scripts/download_models.py
        # (the HF repo ships only the SentencePiece model).
        self._recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=str(MODEL_DIR / ENCODER),
            decoder=str(MODEL_DIR / DECODER),
            joiner=str(MODEL_DIR / JOINER),
            tokens=str(MODEL_DIR / "tokens.txt"),
            num_threads=self._threads,
            decoding_method="greedy_search",
        )

    def postprocess(self, text: str) -> str:
        """Convert the decoder's bare uppercase output to sentence case.

        This model emits "XIN CHÀO HÔM NAY TRỜI RẤT ĐẸP" — all caps, no
        punctuation. The transcript is shown to the user next to the English
        one from Moonshine, which is already sentence-cased and punctuated, so
        leaving it shouting looks broken.

        Proper nouns stay lowercased ("tôi đi hà nội") — recovering them needs
        a casing/punctuation restoration model, which is out of scope here.
        Python's case mapping handles Vietnamese diacritics correctly.
        """
        text = text.strip().lower()
        return text[:1].upper() + text[1:]
