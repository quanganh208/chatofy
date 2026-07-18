"""Stack A / vi — hynt/Zipformer-30M-RNNT-6000h via sherpa-onnx (INT8 ONNX).

Trained on 6,000h Vietnamese; 7.97% WER on VLSP2025-public per the model card.
License CC-BY-NC-ND-4.0 — academic/measurement use only, noted in the report.
"""

from pathlib import Path

import soundfile as sf

from .base import MODELS_DIR, SttEngine, bench_threads, preload_onnxruntime_dll

MODEL_DIR = MODELS_DIR / "zipformer-vi-30m"
HF_REPO = "hynt/Zipformer-30M-RNNT-6000h"
ENCODER = "encoder-epoch-20-avg-10.int8.onnx"
DECODER = "decoder-epoch-20-avg-10.int8.onnx"
JOINER = "joiner-epoch-20-avg-10.int8.onnx"


class SherpaZipformerVi(SttEngine):
    engine_id = "sherpa-zipformer-vi"
    lang = "vi"

    def __init__(self) -> None:
        self._recognizer = None
        self._threads = bench_threads()

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
            decoding_method="greedy_search",
        )

    def transcribe(self, wav_path: Path) -> str:
        samples, sample_rate = sf.read(str(wav_path), dtype="float32")
        stream = self._recognizer.create_stream()
        stream.accept_waveform(sample_rate, samples)
        self._recognizer.decode_stream(stream)
        return stream.result.text

    def decode_params(self) -> dict:
        return {
            "model": HF_REPO,
            "files": [ENCODER, DECODER, JOINER],
            "quantization": "int8",
            "decoding_method": "greedy_search",
            "num_threads": self._threads,
        }
