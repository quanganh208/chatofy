"""ASR judges for round-trip intelligibility, all on the pinned sherpa-onnx.

zh judges (both reported separately, never combined — plan.md):
- `sensevoice-zh`: SenseVoice-Small int8 2024-07-17, language forced to `zh`,
  ITN off (numbers come out as Chinese numerals, no punctuation to strip).
- `paraformer-zh`: Paraformer-zh 2023-09-14, the package's `model.int8.onnx`.

en judge (shared-instance regression only): `parakeet-en`, NeMo Parakeet-TDT
0.6b v2 int8 from the STT sidecar's model dir, read only. The TTS harness had
no English ASR of its own; this is the sidecar's en model.
"""

from pathlib import Path

import numpy as np
import soundfile as sf

from .measure import BENCH_ROOT, MODELS_DIR, bench_threads, preload_onnxruntime_dll

SENSEVOICE_DIR = MODELS_DIR / "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"
PARAFORMER_DIR = MODELS_DIR / "sherpa-onnx-paraformer-zh-2023-09-14"
PARAKEET_DIR = (
    BENCH_ROOT.parent.parent / "services" / "local-stt" / "models"
    / "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"
)
JUDGE_SAMPLE_RATE = 16000


def _require(*paths: Path) -> None:
    missing = [str(p) for p in paths if not p.exists()]
    if missing:
        raise FileNotFoundError(f"judge model files missing: {missing}")


def build_recognizer(judge_id: str):
    preload_onnxruntime_dll()
    import sherpa_onnx

    threads = bench_threads()
    if judge_id == "sensevoice-zh":
        model, tokens = SENSEVOICE_DIR / "model.int8.onnx", SENSEVOICE_DIR / "tokens.txt"
        _require(model, tokens)
        return sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(model), tokens=str(tokens), num_threads=threads,
            language="zh", use_itn=False,
        )
    if judge_id == "paraformer-zh":
        model, tokens = PARAFORMER_DIR / "model.int8.onnx", PARAFORMER_DIR / "tokens.txt"
        _require(model, tokens)
        return sherpa_onnx.OfflineRecognizer.from_paraformer(
            paraformer=str(model), tokens=str(tokens), num_threads=threads,
        )
    if judge_id == "parakeet-en":
        d = PARAKEET_DIR
        files = [d / "encoder.int8.onnx", d / "decoder.int8.onnx", d / "joiner.int8.onnx", d / "tokens.txt"]
        _require(*files)
        return sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=str(files[0]), decoder=str(files[1]), joiner=str(files[2]),
            tokens=str(files[3]), num_threads=threads, model_type="nemo_transducer",
        )
    raise KeyError(f"unknown judge {judge_id!r}")


def _resample(samples: np.ndarray, sr: int) -> np.ndarray:
    """Linear-interpolation resample to 16 kHz; enough for an ASR judge's front end.

    sherpa-onnx would resample internally too, but doing it here keeps the
    judge's input identical across judges.
    """
    if sr == JUDGE_SAMPLE_RATE:
        return samples
    n_out = int(round(len(samples) * JUDGE_SAMPLE_RATE / sr))
    x_old = np.linspace(0.0, 1.0, num=len(samples), endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=n_out, endpoint=False)
    return np.interp(x_new, x_old, samples).astype(np.float32)


def transcribe(recognizer, wav_path: Path) -> str:
    samples, sr = sf.read(str(wav_path), dtype="float32", always_2d=False)
    if samples.ndim != 1:
        samples = samples.mean(axis=1)
    stream = recognizer.create_stream()
    stream.accept_waveform(JUDGE_SAMPLE_RATE, _resample(samples, sr))
    recognizer.decode_stream(stream)
    return stream.result.text.strip()


def decode_params(judge_id: str) -> dict:
    return {
        "sensevoice-zh": {"model": "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/model.int8.onnx",
                          "language": "zh", "use_itn": False},
        "paraformer-zh": {"model": "sherpa-onnx-paraformer-zh-2023-09-14/model.int8.onnx"},
        "parakeet-en": {"model": "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8 (services/local-stt, read-only)"},
    }[judge_id] | {"num_threads": bench_threads()}
