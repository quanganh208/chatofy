"""Mandarin STT — Paraformer-zh int8 (2023-09-14) via sherpa-onnx.

FunASR paraformer-large, packaged for sherpa-onnx by the k2-fsa project.
Non-autoregressive: one pass over the whole utterance, no beam.

Measured on this machine against SenseVoice-small (benchmarks/stt, r11): CER
5.07% on FLEURS and 1.36% on AISHELL-1 (mean 3.22% against SenseVoice's 4.58%),
RTF ~0.014, peak RSS ~420MB, load ~0.9s.

Its output has no punctuation and writes every number as words (`八零二点一一`),
so the display gets marks from the punctuation restorer and digits from the
API's zh ITN; neither changes what this returns. English inside zh speech comes
out as separate lowercase letters or words (`八零二点一一 a`).

No hotword biasing: this offline Paraformer shape takes none.
"""
import re

from .base import MODELS_DIR, SttEngine

RELEASE = "sherpa-onnx-paraformer-zh-2023-09-14"
MODEL_DIR = MODELS_DIR / RELEASE
MODEL_FILE = "model.int8.onnx"
TOKENS_FILE = "tokens.txt"

_HAN = r"㐀-䶿一-鿿豈-﫿"
#: Whitespace with a Han character on BOTH sides. Chinese is written without
#: spaces, so any space the decoder leaves there is an artifact; a space next
#: to a Latin token is a real word boundary and stays.
_SPACE_BETWEEN_HAN = re.compile(rf"(?<=[{_HAN}])\s+(?=[{_HAN}])")


class ParaformerZh(SttEngine):
    lang = "zh"

    def load(self) -> None:
        import sherpa_onnx

        self._recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
            paraformer=str(MODEL_DIR / MODEL_FILE),
            tokens=str(MODEL_DIR / TOKENS_FILE),
            num_threads=self._threads,
            decoding_method="greedy_search",
        )

    def postprocess(self, text: str) -> str:
        """Drop whitespace between Han characters; keep it around Latin tokens."""
        return _SPACE_BETWEEN_HAN.sub("", text.strip())
