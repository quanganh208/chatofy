"""Stack A / en — Moonshine base (INT8 ONNX) via sherpa-onnx.

English-specialized model from Useful Sensors (MIT license); packaged for
sherpa-onnx by the k2-fsa project.
"""

from pathlib import Path

import soundfile as sf

from .base import MODELS_DIR, SttEngine, bench_threads, preload_onnxruntime_dll

# Extracted from the k2-fsa release tarball by download_models.py.
MODEL_DIR = MODELS_DIR / "sherpa-onnx-moonshine-base-en-int8"
ASSET = "sherpa-onnx-moonshine-base-en-int8.tar.bz2"


class SherpaMoonshineEn(SttEngine):
    engine_id = "sherpa-moonshine-en"
    lang = "en"

    def __init__(self) -> None:
        self._recognizer = None
        self._threads = bench_threads()

    def load(self) -> None:
        preload_onnxruntime_dll()
        import sherpa_onnx

        self._recognizer = sherpa_onnx.OfflineRecognizer.from_moonshine(
            preprocessor=str(MODEL_DIR / "preprocess.onnx"),
            encoder=str(MODEL_DIR / "encode.int8.onnx"),
            uncached_decoder=str(MODEL_DIR / "uncached_decode.int8.onnx"),
            cached_decoder=str(MODEL_DIR / "cached_decode.int8.onnx"),
            tokens=str(MODEL_DIR / "tokens.txt"),
            num_threads=self._threads,
        )

    def transcribe(self, wav_path: Path) -> str:
        samples, sample_rate = sf.read(str(wav_path), dtype="float32")
        stream = self._recognizer.create_stream()
        stream.accept_waveform(sample_rate, samples)
        self._recognizer.decode_stream(stream)
        return stream.result.text

    def decode_params(self) -> dict:
        return {
            "model": f"k2-fsa/sherpa-onnx asr-models/{ASSET}",
            "quantization": "int8",
            "decoding_method": "greedy_search",
            "num_threads": self._threads,
        }
