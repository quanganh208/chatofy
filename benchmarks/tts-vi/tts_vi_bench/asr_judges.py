"""The two ASR judges for the round-trip, each configured exactly as in benchmarks/stt.

**PhoWhisper-small scores. Zipformer checks. Neither is combined with the other.**

The ZeroTTS vendor transcribes with two ASRs and takes the per-utterance minimum.
That is not copied here, for three reasons:

`min` is not a neutral operator on a *comparison*. It lowers both systems'
absolute WER, which is what a vendor wants for a headline, but it moves the
*delta between the two TTS systems* in a direction that cannot be stated in
advance: it rewards a system whose errors are idiosyncratic to one judge and
punishes one whose errors are acoustic and therefore shared by both. An operator
with an unpredictable sign on the quantity that IS the deliverable is the wrong
operator.

Our two judges are far less symmetric than the vendor's. They used
whisper-large-v3 with PhoWhisper-large — two large encoder-decoders of
comparable strength, where min approximates best-of-two-equals. Ours are
PhoWhisper-small (AED, INT8) and Zipformer-30M (RNN-T, INT8). A min across those
mostly reproduces whichever is stronger on that acoustic condition, plus noise.

And min would discard the control: `docs/development-journey.md` records a
human-speech floor for each judge separately over these exact 50 VIVOS
utterances. There is no recorded floor for a min-of-two column.

What the second judge genuinely buys is a rank-agreement check: if both judges
order the arms the same way, the conclusion is robust to the judge; if they
disagree, that blocks the verdict rather than being averaged away.

Both judges read their weights from `benchmarks/stt/models/` rather than keeping
a copy, deliberately: the recorded human-speech floors only apply if the weights
are byte-identical to the ones that produced them, and a second download could
drift silently. That harness stores both as plain local directories, so neither
judge resolves a repo id at run time and `HF_HUB_OFFLINE=1` costs nothing.
"""

from dataclasses import dataclass
from pathlib import Path

import soundfile as sf

from .measure import bench_threads

BENCH_ROOT = Path(__file__).resolve().parent.parent
STT_BENCH = BENCH_ROOT.parent / "stt"
ZIPFORMER_DIR = STT_BENCH / "models" / "zipformer-vi-30m"
PHOWHISPER_DIR = STT_BENCH / "models" / "phowhisper-small-ct2"

PHOWHISPER_REPO = "diepho/PhoWhisper-small-ct2"
ZIPFORMER_REPO = "hynt/Zipformer-30M-RNNT-6000h"

#: Human-speech WER over the same 50 VIVOS utterances, from
#: docs/development-journey.md. Quoted in every table as the control: without it
#: a reader cannot tell a bad synthetic voice from the judge's own error floor.
HUMAN_SPEECH_FLOOR_WER = {"phowhisper-small": 0.0771, "zipformer-vi": 0.0538}


@dataclass
class Judgement:
    judge_id: str
    text: str


class PhoWhisperJudge:
    """Scoring judge. faster-whisper INT8, greedy — benchmarks/stt's config.

    Greedy matches the STT harness exactly, so any difference between these
    numbers and that harness's comes from the audio and not from the decoder.
    """

    judge_id = "phowhisper-small"

    def __init__(self) -> None:
        self._model = None

    def load(self) -> None:
        from faster_whisper import WhisperModel

        if not (PHOWHISPER_DIR / "model.bin").exists():
            raise FileNotFoundError(
                f"PhoWhisper weights missing from {PHOWHISPER_DIR}. Run "
                "benchmarks/stt's scripts/download_models.py first — this harness "
                "reads that copy so the recorded human-speech floor applies."
            )
        self._model = WhisperModel(
            str(PHOWHISPER_DIR),
            device="cpu",
            compute_type="int8",
            cpu_threads=bench_threads(),
        )

    def transcribe(self, wav_path: Path) -> str:
        segments, _info = self._model.transcribe(str(wav_path), language="vi", beam_size=1)
        return " ".join(segment.text.strip() for segment in segments)

    def decode_params(self) -> dict:
        return {"model": PHOWHISPER_REPO, "compute_type": "int8",
                "beam_size": 1, "language": "vi", "threads": bench_threads()}


class ZipformerJudge:
    """Rank-agreement judge — and the app's own STT.

    "Does the recognizer actually in the product understand this voice?" is a
    question the headline judge cannot answer. Its brittleness on synthetic
    audio (6,000h of real speech, no exposure to a vocoder's flat noise floor)
    is exactly why its output is reported separately and never merged into the
    score.

    Weights are CC-BY-NC-ND-4.0 — academic and measurement use only, which is
    what this is.
    """

    judge_id = "zipformer-vi"

    def __init__(self) -> None:
        self._recognizer = None

    def load(self) -> None:
        import sherpa_onnx

        missing = [p for p in ("encoder-epoch-20-avg-10.int8.onnx",
                               "decoder-epoch-20-avg-10.int8.onnx",
                               "joiner-epoch-20-avg-10.int8.onnx",
                               "tokens.txt")
                   if not (ZIPFORMER_DIR / p).exists()]
        if missing:
            raise FileNotFoundError(
                f"Zipformer weights missing from {ZIPFORMER_DIR}: {missing}. "
                "Run benchmarks/stt's scripts/download_models.py first — this "
                "harness reads that copy so the recorded human-speech floor applies."
            )
        self._recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=str(ZIPFORMER_DIR / "encoder-epoch-20-avg-10.int8.onnx"),
            decoder=str(ZIPFORMER_DIR / "decoder-epoch-20-avg-10.int8.onnx"),
            joiner=str(ZIPFORMER_DIR / "joiner-epoch-20-avg-10.int8.onnx"),
            tokens=str(ZIPFORMER_DIR / "tokens.txt"),
            num_threads=bench_threads(),
            # Shipping configuration: greedy, unbiased. Hotwords would measure
            # the biasing plumbing, not whether the voice is intelligible.
            decoding_method="greedy_search",
        )

    def transcribe(self, wav_path: Path) -> str:
        samples, sample_rate = sf.read(str(wav_path), dtype="float32")
        stream = self._recognizer.create_stream()
        stream.accept_waveform(sample_rate, samples)
        self._recognizer.decode_stream(stream)
        return stream.result.text

    def decode_params(self) -> dict:
        return {"model": ZIPFORMER_REPO, "quantization": "int8",
                "decoding_method": "greedy_search", "hotwords": None,
                "threads": bench_threads()}


JUDGES = {cls.judge_id: cls for cls in (PhoWhisperJudge, ZipformerJudge)}
#: The one whose numbers are the headline. The other is the agreement check.
SCORING_JUDGE = PhoWhisperJudge.judge_id


def download_judges() -> None:
    """Report on the borrowed weights. Neither judge downloads: both read benchmarks/stt."""
    for label, path in (("phowhisper", PHOWHISPER_DIR), ("zipformer", ZIPFORMER_DIR)):
        if path.exists():
            print(f"[asr] {label} read from {path}", flush=True)
        else:
            print(f"[asr] WARNING: {path} missing; run benchmarks/stt's "
                  "scripts/download_models.py", flush=True)
