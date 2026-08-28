"""Stack A / vi — hynt/Zipformer-30M-RNNT-6000h via sherpa-onnx (INT8 ONNX).

Trained on 6,000h Vietnamese; 7.97% WER on VLSP2025-public per the model card.
License CC-BY-NC-ND-4.0 — academic/measurement use only, noted in the report.

`SherpaZipformerVi` is the shipping configuration and the engine whose numbers
the recorded r1/r2 results describe: greedy decoding, no biasing, mirroring
`services/local-stt/engines/zipformer_vi.py`. The three arms below vary ONLY the
decoder so a comparison run isolates what beam search and contextual biasing
buy; model files, quantization and thread count are held fixed.
"""

from pathlib import Path

import soundfile as sf

from .base import BENCH_ROOT, MODELS_DIR, SttEngine, bench_threads, preload_onnxruntime_dll

MODEL_DIR = MODELS_DIR / "zipformer-vi-30m"
HF_REPO = "hynt/Zipformer-30M-RNNT-6000h"
ENCODER = "encoder-epoch-20-avg-10.int8.onnx"
DECODER = "decoder-epoch-20-avg-10.int8.onnx"
JOINER = "joiner-epoch-20-avg-10.int8.onnx"

HOTWORDS_PATH = BENCH_ROOT / "data" / "hotwords-vi.txt"
# sherpa-onnx default. Raising it forces hotword phrases into the output even
# against contrary acoustics, which measures the biasing plumbing rather than
# its usefulness; the arm keeps the default so the number describes normal use.
HOTWORDS_SCORE = 1.5
# sherpa-onnx default beam width for modified_beam_search.
MAX_ACTIVE_PATHS = 4


class SherpaZipformerVi(SttEngine):
    """Shipping configuration: greedy, unbiased. Base class for the decode arms."""

    engine_id = "sherpa-zipformer-vi"
    lang = "vi"

    #: Decoder under test. Subclasses override to form a comparison arm.
    decoding_method = "greedy_search"
    #: Contextual biasing list, or None for an unbiased arm.
    hotwords_path: Path | None = None

    def __init__(self) -> None:
        self._recognizer = None
        self._threads = bench_threads()

    def _recognizer_kwargs(self) -> dict:
        """Decoder-specific arguments layered onto the fixed model config."""
        kwargs: dict = {"decoding_method": self.decoding_method}
        if self.decoding_method == "modified_beam_search":
            kwargs["max_active_paths"] = MAX_ACTIVE_PATHS
        if self.hotwords_path is not None:
            if not self.hotwords_path.exists():
                raise FileNotFoundError(
                    f"hotwords list {self.hotwords_path} missing;"
                    " run: uv run python scripts/build_hotwords_vi.py"
                )
            # The vi BPE vocabulary is uppercase and sherpa-onnx encodes hotword
            # phrases through it, so bpe.vocab must accompany the tokens table.
            kwargs.update(
                hotwords_file=str(self.hotwords_path),
                hotwords_score=HOTWORDS_SCORE,
                modeling_unit="bpe",
                bpe_vocab=str(MODEL_DIR / "bpe.vocab"),
            )
        return kwargs

    def load(self) -> None:
        preload_onnxruntime_dll()
        import sherpa_onnx

        # tokens.txt is generated from bpe.model by download_models.py (the HF
        # repo ships only the SentencePiece model).
        self._recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=str(MODEL_DIR / ENCODER),
            decoder=str(MODEL_DIR / DECODER),
            joiner=str(MODEL_DIR / JOINER),
            tokens=str(MODEL_DIR / "tokens.txt"),
            num_threads=self._threads,
            **self._recognizer_kwargs(),
        )

    def transcribe(self, wav_path: Path) -> str:
        samples, sample_rate = sf.read(str(wav_path), dtype="float32")
        stream = self._recognizer.create_stream()
        stream.accept_waveform(sample_rate, samples)
        self._recognizer.decode_stream(stream)
        return stream.result.text

    def decode_params(self) -> dict:
        params = {
            "model": HF_REPO,
            "files": [ENCODER, DECODER, JOINER],
            "quantization": "int8",
            "decoding_method": self.decoding_method,
            "num_threads": self._threads,
        }
        if self.decoding_method == "modified_beam_search":
            params["max_active_paths"] = MAX_ACTIVE_PATHS
        if self.hotwords_path is not None:
            params["hotwords_file"] = self.hotwords_path.name
            params["hotwords_score"] = HOTWORDS_SCORE
            params["hotwords_note"] = "oracle ceiling — list derived from the test set's own references"
        return params


class SherpaZipformerViGreedy(SherpaZipformerVi):
    """Decode-arm control. Identical settings to the shipping engine, re-run in
    the same session as the other arms so the three are compared on one machine
    rather than against the differently-dated r1/r2 numbers."""

    engine_id = "sherpa-zipformer-vi-greedy"


class SherpaZipformerViBeam(SherpaZipformerVi):
    engine_id = "sherpa-zipformer-vi-beam"
    decoding_method = "modified_beam_search"


class SherpaZipformerViBeamHotwords(SherpaZipformerViBeam):
    engine_id = "sherpa-zipformer-vi-beam-hotwords"
    hotwords_path = HOTWORDS_PATH
