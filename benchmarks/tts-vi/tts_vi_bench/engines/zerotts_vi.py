"""Vietnamese TTS — ZeroTTS (fp32 ONNX, CPU, torch-free).

Every constructor argument below overrides a package default that would
otherwise bias this benchmark. They are set explicitly, and the reasons are
recorded here rather than in a commit message, because each one is invisible in
the output it corrupts.

**Threads.** `ZeroTTS.__init__` defaults `intra_op_num_threads=4`
(`synthesizer.py`), where VieNeu is constructed with 8. Left alone the
challenger runs on half the CPU of the incumbent and nothing in the result says
so. `codec_intra_op_num_threads` is a second, separate knob — the codec decoder
is its own session and the streaming path's cost lives there — so both are set
and both are recorded.

**Warm-up.** `__init__` defaults `warmup=True` and pushes a dummy request
through every hot-path session during construction. That lands inside the timed
`load()`, which VieNeu has no equivalent of, and the harness then runs its own
untimed warm-up sentence on top — so ZeroTTS would warm twice and VieNeu once.
Constructed with `warmup=False`; the harness's warm-up serves both engines
identically.

**Seeding.** The model draws from the *global* `np.random` on every generated
frame and exposes no seed parameter. Unseeded, every latency, RTF, TTFA and WER
figure is one draw from a distribution rather than a measurement. Seeded
immediately before each synthesis, and the seed is recorded. VieNeu is seeded
the same way from the same `measure.SEED`; that argument was always
engine-independent, and applying it here only is what the first run of this
benchmark got wrong.

Seeding is necessary but not sufficient for bit-reproducibility: the sampling
happens *inside* the ONNX graph against fp32 logits, and top-k/top-p over an
autoregressive loop turns a one-ULP difference into a divergent utterance. So
the thread count and the `onnxruntime` version are pinned too, and results are
claimed only at the recorded seed, threads and runtime.
"""

from collections.abc import Iterator

import numpy as np

from ..measure import SEED, bench_threads
from .base import TtsEngine

#: The two presets this arm speaks with, chosen from the eight the package ships.
#:
#: Both are the manifest's "rõ ràng" (clear) pair — `baotrang` is labelled
#: "trưởng thành, tin tức, rõ ràng, trung tính" and `quangminh` "trẻ, tin tức,
#: rõ ràng, dứt khoát". That register is the one this product needs: a voice
#: translator reads back short conversational utterances where being understood
#: is the whole job. The rejected six carry prosody built for something else —
#: four are "kể chuyện" (storytelling, long-form pacing), `hamy` is "hoạt hình"
#: (cartoon, high and expressive), `tiendat` is "bình luận ... năng lượng cao"
#: (commentary). See `scripts/audition_voices.py`, which renders all eight.
DEFAULTS = {"female": "baotrang", "male": "quangminh"}


class ZeroTtsVi(TtsEngine):
    engine_id = "zerotts-vi"
    VOICES = DEFAULTS
    supports_streaming = True

    def __init__(self) -> None:
        self._tts = None
        self._threads = bench_threads()

    def load(self) -> None:
        from zerotts import ZeroTTS
        from zerotts import hub

        self._revision = hub.DEFAULT_REVISION
        self._repo_id = hub.DEFAULT_REPO_ID
        self._tts = ZeroTTS.from_pretrained(
            hub.DEFAULT_REPO_ID,
            # The package pins its own weights revision to an exact commit sha,
            # with a docstring explaining that resolving `main` instead couples
            # every released version to whatever was last pushed. Passing None
            # takes that pin; it is a stronger guarantee than re-deriving one.
            revision=None,
            intra_op_num_threads=self._threads,
            codec_intra_op_num_threads=self._threads,
            warmup=False,
        )

    def synthesize(self, text: str, voice: str) -> tuple[np.ndarray, int]:
        np.random.seed(SEED)
        samples = self._tts.synthesize(text, voice=voice)
        return np.asarray(samples, dtype=np.float32).reshape(-1), self._tts.sample_rate

    def synthesize_stream(self, text: str, voice: str) -> Iterator[np.ndarray]:
        """Yield chunks, seeding at the point the draws actually happen.

        `synthesize_stream` is a generator function, so calling it runs nothing —
        not even voice resolution — and the RNG draws happen lazily, one per
        frame, as the consumer iterates. Seeding before the call rather than
        before iteration would leave the stream exposed to any other global-RNG
        consumer that ran in between. The seed is applied here, immediately
        before the first `next()`, and `decode_params` records that it was.
        """
        stream = self._tts.synthesize_stream(text, voice=voice)
        np.random.seed(SEED)
        for chunk in stream:
            yield np.asarray(chunk, dtype=np.float32).reshape(-1)

    @property
    def sample_rate(self) -> int:
        return self._tts.sample_rate

    def decode_params(self) -> dict:
        import importlib.metadata as md

        return {
            "package": "zerotts",
            "package_version": md.version("zerotts"),
            "repo_id": self._repo_id,
            "weights_revision": self._revision,
            "model_dir": str(getattr(self._tts, "model_dir", "")),
            "intra_op_num_threads": self._threads,
            "codec_intra_op_num_threads": self._threads,
            "warmup_on_construct": False,
            "seed": SEED,
            "seed_applied_at": "immediately before iteration (stream) / call (whole)",
            # The package's own defaults, recorded because they are what was run.
            "cfg_scale": 1.0,
            "text_temperature": 1.0,
            "text_topk": 50,
            "audio_temperature": 0.8,
            "audio_topk": 25,
            "audio_topp": 0.95,
            "audio_repetition_penalty": 1.2,
        }
