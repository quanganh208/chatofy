"""The one Kokoro instance the en and zh engines share.

Kokoro v1_0 is multilingual: one `OfflineTts` loaded with both lexicons speaks
English with speakers 0-19 and Mandarin with 45-52. Loading it once instead of
twice saves the model's ~600MB a second copy would cost, at +13MB RSS for the
zh lexicon (benchmarks/tts, zh-r1). Measured on the en sets: speed and judge
WER unchanged by the added lexicon, including on sentences full of digits.

No rule FSTs. sherpa-onnx applies them to EVERY text the instance reads, and all
three zh FSTs it ships rewrite digits in English (`number-zh`: "room 402" ->
"room 四百零二"; `date-zh`: "1998" -> "一九九八", spoken "Ichochopa"; `phone-zh`:
a 16-digit run). The zh engine verbalizes its own digits before synthesis
instead (`zh_number_verbalizer.py`).

One lock for the instance, handed to both engines, so it is never driven from
two threads. The instance is reference counted: `unload_all` followed by
`load_all` drops it with the last engine and builds it again with the first.
"""
import threading
from collections.abc import Iterator

import numpy as np

from .base import MODELS_DIR, TtsEngine, preload_onnxruntime_dll
from .clause_splitter import split_into_clauses

MODEL_DIR = MODELS_DIR / "kokoro-multi-lang-v1_0"
LEXICONS = ("lexicon-us-en.txt", "lexicon-zh.txt")
#: Deliberately empty; see the module docstring.
RULE_FSTS: tuple[str, ...] = ()


class KokoroRuntime:
    """Builds the shared `OfflineTts` on first acquire, frees it on last release."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self._guard = threading.Lock()
        self._tts = None
        self._refs = 0

    def acquire(self, threads: int):
        with self._guard:
            if self._tts is None:
                self._tts = _build(threads)
            self._refs += 1
            return self._tts

    def release(self) -> None:
        with self._guard:
            self._refs = max(0, self._refs - 1)
            if self._refs == 0:
                self._tts = None


def _build(threads: int):
    preload_onnxruntime_dll()
    import sherpa_onnx

    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=str(MODEL_DIR / "model.onnx"),
                voices=str(MODEL_DIR / "voices.bin"),
                tokens=str(MODEL_DIR / "tokens.txt"),
                lexicon=",".join(str(MODEL_DIR / name) for name in LEXICONS),
                data_dir=str(MODEL_DIR / "espeak-ng-data"),
            ),
            num_threads=threads,
            provider="cpu",
        ),
        rule_fsts=",".join(str(MODEL_DIR / name) for name in RULE_FSTS),
    )
    # validate() returns False rather than raising on a bad path; skipping
    # this check turns a missing file into an obscure crash much later.
    if not config.validate():
        raise RuntimeError(f"invalid Kokoro config — check the model files in {MODEL_DIR}")
    return sherpa_onnx.OfflineTts(config)


RUNTIME = KokoroRuntime()


class SharedKokoroEngine(TtsEngine):
    """A Kokoro language: the shared instance, its lock, and a text hook."""

    #: Unseeded, and each clause is an independent `generate`, so nothing ties
    #: one clause to the lock the previous one held. Locking per clause lets a
    #: second turn wait one clause behind this one instead of all of it — and an
    #: en turn and a zh turn on the shared instance take turns the same way.
    HOLDS_LOCK_FOR_TURN = False
    #: `generate(..., speed=)` is honoured by this runtime, unlike VieNeu's.
    SPEED_ADJUSTABLE = True

    def __init__(self) -> None:
        super().__init__(lock=RUNTIME.lock)

    def prepare(self, text: str) -> str:
        """What the engine reads for `text`. Identity unless a language needs more."""
        return text

    def _voice_token(self, entry) -> int:
        # sherpa-onnx addresses speakers by integer id; the catalog carries every
        # token as a string because that is what crosses the wire.
        return int(entry.token)

    def load(self) -> None:
        self._engine = RUNTIME.acquire(self._threads)

    def unload(self) -> None:
        if self._engine is not None:
            self._engine = None
            RUNTIME.release()

    @property
    def sample_rate(self) -> int:
        return self._engine.sample_rate

    def _infer(self, text: str, voice: int | str, speed: float) -> tuple[np.ndarray, int]:
        audio = self._engine.generate(self.prepare(text), sid=int(voice), speed=speed)
        return np.asarray(audio.samples, dtype=np.float32), audio.sample_rate

    def _infer_stream(self, text: str, voice: int | str, speed: float) -> Iterator[np.ndarray]:
        """One chunk per clause, each synthesized whole and in order.

        sherpa-onnx's `OfflineTts` only produces audio at sentence boundaries —
        its streaming callback fired once for a one-sentence turn, at the same
        moment the call returned (re-measured on 1.13.4). Cutting at clauses in
        front of it is what moves this engine's first audio.

        No callback is passed. Every clause ends at the latest at a sentence
        terminator, so the callback would fire once per clause anyway — and its
        return value is inverted against its own docstring on 1.13.4 (returning
        0 STOPS generation), which is a truncation bug waiting for whoever relies
        on the documentation.

        Sequential by construction: one `generate` finishes before the next
        starts, and `TtsEngine.stream` holds the shared lock around each one.
        """
        for clause in split_into_clauses(text):
            audio = self._engine.generate(self.prepare(clause), sid=int(voice), speed=speed)
            yield np.asarray(audio.samples, dtype=np.float32)
