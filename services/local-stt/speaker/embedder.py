"""Speaker embeddings, alongside the recognizers but never behind them.

One warm sherpa-onnx extractor turning a few seconds of speech into a vector
that can be compared to another by cosine. Nothing here decides who spoke — it
answers "how does this voice sit relative to that one" and stops. The deciding
happens in the browser, from vectors this returns.

**Not an `SttEngine`, deliberately.** It transcribes nothing and has no language.
Registering it in `engines/registry.py` would put it behind `registry.get(lang)`,
whose language set is closed on purpose, and would give it a name in a namespace
where every other entry answers a different question.

**Its own lock, and that is the whole latency argument.** `registry.py` gives
each recognizer a lock because a sherpa-onnx object is not assumed safe for
concurrent use. This gets the same treatment and a separate one: sharing a lock
with the Vietnamese recognizer would make every embedding wait behind a decode,
which is exactly the serialization the caller went to the trouble of a second
HTTP request to avoid.

**Two threads, not eight.** `engines/base.py` gives each recognizer 8, tuned to
physical cores. The embedding nets are small, and in production this runs beside
a recognizer already holding those 8 on an 8-core box — asking for 8 more
oversubscribes and slows the decode down. Two is the value the latency bench
measured contention at.

**fp32 is expected.** The sherpa-onnx release publishes no int8 variant of any
speaker model, unlike the ASR ones. Do not quantise before measuring.
"""
import threading

import numpy as np

from engines.base import MODELS_DIR, SAMPLE_RATE

#: The measured model. Chosen on latency rather than accuracy: it keeps 82% of
#: the turn's time budget free under full load where the more accurate candidate
#: kept 28%, and the accuracy difference between them was inside the noise.
MODEL_FILENAME = "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"

#: See the module docstring. Not `stt_threads()`.
EMBED_THREADS = 2


class SpeakerEmbedder:
    """One warm extractor. Load once at startup, call from any thread."""

    def __init__(self) -> None:
        self._extractor = None
        self._lock = threading.Lock()

    @property
    def model_path(self):
        return MODELS_DIR / MODEL_FILENAME

    @property
    def loaded(self) -> bool:
        return self._extractor is not None

    def load(self) -> None:
        """Build the extractor.

        Must be called AFTER `preload_onnxruntime_dll()` has run — importing
        sherpa-onnx before it resolves the wrong shared library and kills the
        process outright, with no Python traceback to read. The registry's
        `load_all()` does that first, so this loads after it.
        """
        if not self.model_path.exists():
            raise FileNotFoundError(
                f"{self.model_path} is missing. Run: python scripts/download_models.py"
            )
        import sherpa_onnx

        config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=str(self.model_path),
            num_threads=EMBED_THREADS,
            debug=False,
        )
        if not config.validate():
            raise RuntimeError(f"invalid speaker extractor config for {self.model_path}")
        self._extractor = sherpa_onnx.SpeakerEmbeddingExtractor(config)

    def unload(self) -> None:
        self._extractor = None

    @property
    def dim(self) -> int:
        if self._extractor is None:
            raise RuntimeError("speaker extractor not loaded")
        return self._extractor.dim

    def embed(self, samples: np.ndarray) -> list[float]:
        """One utterance of mono float32 at SAMPLE_RATE → a unit-norm vector.

        Normalized here rather than by each caller. Every consumer compares these
        by cosine, and an unnormalized vector reaching a threshold comparison
        does not fail — it produces a number, just the wrong one, which is the
        kind of defect that survives a whole release.
        """
        if self._extractor is None:
            raise RuntimeError("speaker extractor not loaded")
        with self._lock:
            stream = self._extractor.create_stream()
            stream.accept_waveform(sample_rate=SAMPLE_RATE, waveform=samples)
            stream.input_finished()
            vector = np.array(self._extractor.compute(stream), dtype=np.float32)

        norm = float(np.linalg.norm(vector))
        if norm == 0.0:
            # Silence, or something the model had nothing to say about. Returned
            # as zeros rather than divided by zero; a caller comparing it scores
            # 0 against everything, which is the honest answer.
            return vector.tolist()
        return (vector / norm).tolist()
