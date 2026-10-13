"""zh arm — SenseVoice-Small int8 (2024-07-17 multilingual release) via sherpa-onnx.

Release: k2-fsa asr-models `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17`
(FunAudioLLM SenseVoiceSmall; model licence: FunASR model licence, see the
tarball's LICENSE). NOT the 2025-09-09 release: that one is a Cantonese
fine-tune that emits no punctuation.

Two ids, same weights, same thread count; only `use_itn` differs:
- `sherpa-sensevoice-zh` — `use_itn=True`, what a product would ship: the model
  itself emits punctuation and Arabic numerals.
- `sherpa-sensevoice-zh-noitn` — `use_itn=False`: numbers come out as Chinese
  numerals, matching the spoken form, which is how the CER comparison against
  Paraformer (no ITN at all) is scored.
"""

from pathlib import Path

import soundfile as sf

from .base import MODELS_DIR, SttEngine, bench_threads, preload_onnxruntime_dll

RELEASE = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"
MODEL_DIR = MODELS_DIR / RELEASE
MODEL_FILE = "model.int8.onnx"
LANGUAGE = "zh"


class SherpaSenseVoiceZh(SttEngine):
    engine_id = "sherpa-sensevoice-zh"
    lang = "zh"
    use_itn = True

    def __init__(self) -> None:
        self._recognizer = None
        self._threads = bench_threads()

    def load(self) -> None:
        preload_onnxruntime_dll()
        import sherpa_onnx

        model_path = MODEL_DIR / MODEL_FILE
        if not model_path.is_file():
            raise FileNotFoundError(
                f"{model_path} missing; run: uv run python scripts/download_models.py --only sensevoice-zh"
            )
        self._recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(model_path),
            tokens=str(MODEL_DIR / "tokens.txt"),
            num_threads=self._threads,
            language=LANGUAGE,
            use_itn=self.use_itn,
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
            "language": LANGUAGE,
            "use_itn": self.use_itn,
            "decoding_method": "greedy_search",
            "num_threads": self._threads,
        }


class SherpaSenseVoiceZhNoItn(SherpaSenseVoiceZh):
    engine_id = "sherpa-sensevoice-zh-noitn"
    use_itn = False
