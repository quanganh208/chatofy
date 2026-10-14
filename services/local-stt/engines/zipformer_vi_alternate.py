"""Second Vietnamese recognizer — hynt/ZipFormer-150M-CR-CTC-RNNT-6000h (INT8 ONNX).

Not a replacement for `zipformer_vi.py` and never the transcript of record. It
decodes the same final turn beside it, and the API hands both readings to an
LLM that picks between them word by word for the DISPLAY only. Measured on the
95-turn vi ruler (6 recordings, Scribe reference): the 30M alone 5.72% WER,
this model alone 6.30% (it drops number words), the two fused ~4.9% — see
docs/development-journey.md. A second opinion is what it is worth, not a
better first one.

OPTIONAL, unlike every recognizer in the registry: missing weights are a
warning and a sidecar with no alternates, never a failed /healthz. The display
without it is exactly today's.

Greedy only, never biased. The hotword path exists on the 30M because a term
the conversation named has to be able to land; here the point is an
independent reading, and pulling it towards the same terms would make the two
agree for the wrong reason.

LICENSE: CC-BY-NC-ND-4.0, same as the 30M — academic / thesis use only.
"""
from .base import MODELS_DIR, SttEngine
from .zipformer_vi import DECODING_METHOD, sentence_case

MODEL_DIR = MODELS_DIR / "zipformer-vi-150m"
ENCODER = "encoder-epoch-11-avg-2.int8.onnx"
DECODER = "decoder-epoch-11-avg-2.int8.onnx"
JOINER = "joiner-epoch-11-avg-2.int8.onnx"
TOKENS = "tokens.txt"


class ZipformerViAlternate(SttEngine):
    lang = "vi"

    @staticmethod
    def weights_present() -> bool:
        """Whether the seed fetched this model; checked before any load is tried."""
        return all((MODEL_DIR / name).exists() for name in (ENCODER, DECODER, JOINER, TOKENS))

    def load(self) -> None:
        import sherpa_onnx

        # Its own recognizer and, through `SttEngine`, its own lanes: a burst of
        # alternate decodes can saturate this engine without ever taking a lane
        # from the 30M that every live re-read depends on.
        self._recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=str(MODEL_DIR / ENCODER),
            decoder=str(MODEL_DIR / DECODER),
            joiner=str(MODEL_DIR / JOINER),
            tokens=str(MODEL_DIR / TOKENS),
            num_threads=self._threads,
            decoding_method=DECODING_METHOD,
        )

    def postprocess(self, text: str) -> str:
        return sentence_case(text)
