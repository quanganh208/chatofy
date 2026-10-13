"""zh arm — Paraformer-zh int8 (2023-09-14) via sherpa-onnx.

Release: k2-fsa asr-models `sherpa-onnx-paraformer-zh-2023-09-14` (FunASR
paraformer-large, Mandarin + English). Non-autoregressive, no punctuation and
no ITN: output is bare characters with numbers spelled as Chinese numerals, so
a product would still need a punctuation restorer behind it.
"""

from pathlib import Path

import soundfile as sf

from .base import MODELS_DIR, SttEngine, bench_threads, preload_onnxruntime_dll

RELEASE = "sherpa-onnx-paraformer-zh-2023-09-14"
MODEL_DIR = MODELS_DIR / RELEASE
MODEL_FILE = "model.int8.onnx"


class SherpaParaformerZh(SttEngine):
    engine_id = "sherpa-paraformer-zh"
    lang = "zh"

    def __init__(self) -> None:
        self._recognizer = None
        self._threads = bench_threads()

    def load(self) -> None:
        preload_onnxruntime_dll()
        import sherpa_onnx

        model_path = MODEL_DIR / MODEL_FILE
        if not model_path.is_file():
            raise FileNotFoundError(
                f"{model_path} missing; run: uv run python scripts/download_models.py --only paraformer-zh"
            )
        self._recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
            paraformer=str(model_path),
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
            "model": RELEASE,
            "files": [MODEL_FILE],
            "quantization": "int8",
            "decoding_method": "greedy_search",
            "num_threads": self._threads,
        }
