"""Streaming stack — nvidia/nemotron-3.5-asr-streaming-0.6b via parakeet.cpp.

The only candidate here whose prefix is append-only by construction: it decodes
causally in chunks and never revisits audio it has already consumed. Every other
engine in this harness re-decodes the whole utterance, which is fine for a
transcript on a screen and unusable for one that has already been spoken aloud.

So this engine is not competing with the others on accuracy alone. It is
competing on accuracy AT A PROPERTY THE OTHERS CANNOT OFFER, and the point of
benchmarking it here is to price that property in WER on the same 50 utterances
everything else was measured on.

Registered once per quantization so the sweep is a normal benchmark run rather
than a separate script: the weights differ, the code does not.

Needs `LOCAL_STT_PARAKEET_LIB` pointing at libparakeet.so (built from source,
see services/local-stt/README.md) and the GGUF weights under models/.
"""

from pathlib import Path

import soundfile as sf

from .base import MODELS_DIR, SttEngine, bench_threads

HF_REPO = "mudler/parakeet-cpp-gguf"
BASE_MODEL = "nvidia/nemotron-3.5-asr-streaming-0.6b"
MODEL_DIR = MODELS_DIR / "nemotron-streaming-0.6b"

#: Locale string the multilingual prompt expects. Bare "vi" is rejected.
LOCALES = {"vi": "vi-VN", "en": "en-US"}


#: Chunk the streaming mode feeds at, matching the partial-transcript cadence
#: the app actually uses. Smaller chunks mean less right context per decode, so
#: this is a latency/accuracy dial, not a free parameter.
STREAM_CHUNK_MS = 300


class ParakeetNemotron(SttEngine):
    """One (language, quantization, mode) combination of the streaming model.

    `mode` matters more than it looks. Offline decoding sees the whole utterance
    and is what every other engine here does, so it is the fair column in the
    accuracy table. Streaming decoding is what the app runs, and it sees only
    the audio so far — the gap between the two columns IS the cost of being
    able to speak mid-sentence, and it is not measurable any other way.
    """

    lang: str

    def __init__(self, lang: str, quant: str, mode: str = "offline") -> None:
        if mode not in ("offline", "stream"):
            raise ValueError(f"mode must be offline|stream, got {mode!r}")
        self.lang = lang
        self.engine_id = f"parakeet-nemotron-{quant}-{mode}-{lang}"
        self._quant = quant
        self._mode = mode
        self._threads = bench_threads()
        self._model = None

    @property
    def _weights(self) -> Path:
        return MODEL_DIR / f"nemotron-3.5-asr-streaming-0.6b-{self._quant}.gguf"

    def load(self) -> None:
        # Imported from the service rather than duplicated: the binding under
        # test must be the one that ships, or the numbers describe code nobody
        # runs. Same argument applies to the tag filter below — measuring
        # unfiltered output once already cost 22 points of phantom WER.
        from stt_bench.parakeet_binding import ParakeetModel, strip_language_tags

        self._model = ParakeetModel(self._weights)
        self._strip = strip_language_tags

    def transcribe(self, wav_path: Path) -> str:
        samples, sample_rate = sf.read(str(wav_path), dtype="float32")
        locale = LOCALES[self.lang]
        if self._mode == "offline":
            return self._strip(self._model.transcribe(samples, locale))

        step = int(sample_rate * STREAM_CHUNK_MS / 1000)
        text = ""
        with self._model.stream(locale) as session:
            for start in range(0, len(samples), step):
                new_text, _events = session.feed(samples[start : start + step])
                text += new_text
            text += session.finalize()
        return self._strip(text)

    def decode_params(self) -> dict:
        return {
            "model": HF_REPO,
            "base_model": BASE_MODEL,
            "files": [self._weights.name],
            "quantization": self._quant,
            "mode": self._mode,
            "chunk_ms": STREAM_CHUNK_MS if self._mode == "stream" else None,
            "decoding_method": "greedy_search (tdt)",
            "prefix_monotone": True,
            "num_threads": self._threads,
        }
