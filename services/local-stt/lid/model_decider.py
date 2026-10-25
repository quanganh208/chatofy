"""Whisper base as a language classifier: the language token's probabilities at its first decoder step.

Whisper predicts a language token right after <|startoftranscript|>; the
softmax over those tokens IS a language classifier. Only the candidates'
logits are kept, so the answer is always one of them, and their renormalised
softmax is the confidence.

Chosen by measurement over four other mechanisms (AmberNet, MMS-LID, competing
recognizers, other Whisper sizes) on public conversational speech and its
re-recordings — `benchmarks/lid/README.md`. What shipped is exactly what was
scored there: the onnx-community export at the pinned revision on this
sidecar's onnxruntime, the encoder cut to the turn (`lid.window`) with a 5 s
floor: Whisper was trained on 30 s windows and loses short turns on a
shorter one. vi↔en passed every criterion; zh did not, so the API only asks
for vi and en.

Never decodes text: the first decoder step is all it runs. The transcript is
the chosen language's own engine, with that conversation's hotwords.

LICENSE: MIT (OpenAI Whisper weights, onnx-community export).
"""
import json
import threading

import numpy as np

from engines.base import MODELS_DIR, SttBusyError, stt_concurrency, stt_lane_wait_ms, stt_threads
from lid.log_mel import MAX_SAMPLES, RATE, log_mel

MODEL_DIR = MODELS_DIR / "whisper-base-lid"
ENCODER = "onnx/encoder_model.onnx"
DECODER = "onnx/decoder_model.onnx"
TOKENIZER = "tokenizer.json"
FILES = (ENCODER, DECODER, TOKENIZER)

SOT = "<|startoftranscript|>"
#: The languages it is asked about. Whisper knows ~100; these are the ones the
#: sidecar has an engine for.
LANGUAGES = ("vi", "en", "zh")

#: The encoder sees at least this much: the turn, then Whisper's own zero
#: padding. Measured: a 1 s floor left turns under 1.5 s at 0.837 on the
#: one-way vi/en/zh criterion, 5 s brought them to 0.892, and the latency it
#: added kept p95 at 126 ms against a 150 ms budget.
MIN_WINDOW_S = 5
#: Windows are whole seconds, so a run of turns reuses a handful of shapes.
WINDOW_STEP_S = 1


def window_samples(n: int) -> int:
    """Samples the mel covers: the turn rounded up to a step, at least the floor, at most 30 s."""
    step = WINDOW_STEP_S * RATE
    return min(MAX_SAMPLES, max(MIN_WINDOW_S * RATE, -(-n // step) * step))


class WhisperLanguageId:
    """The loaded classifier, with lanes of its own like an engine.

    Its own lanes rather than an engine's: identifying a turn must not take the
    decode lane that the chosen language's engine needs right after. Busy is a
    refusal (`SttBusyError`) the caller answers by decoding the declared
    language, never a queue.
    """

    def __init__(self) -> None:
        self._encoder = None
        self._decoder = None
        self._sot = 0
        self._ids: dict[str, int] = {}
        self._lanes = threading.Semaphore(stt_concurrency())
        self._lane_wait_ms = stt_lane_wait_ms()

    @staticmethod
    def weights_present() -> bool:
        return all((MODEL_DIR / name).exists() for name in FILES)

    @property
    def loaded(self) -> bool:
        return self._decoder is not None

    def load(self) -> None:
        import onnx
        import onnxruntime as ort

        from lid.window import window

        options = ort.SessionOptions()
        options.intra_op_num_threads = stt_threads()
        encoder = window(onnx.load(MODEL_DIR / ENCODER)).SerializeToString()
        self._encoder = ort.InferenceSession(encoder, options, providers=["CPUExecutionProvider"])
        self._decoder = ort.InferenceSession(
            str(MODEL_DIR / DECODER), options, providers=["CPUExecutionProvider"]
        )
        tokens = json.loads((MODEL_DIR / TOKENIZER).read_text())["added_tokens"]
        vocab = {token["content"]: token["id"] for token in tokens}
        self._sot = vocab[SOT]
        self._ids = {lang: vocab[f"<|{lang}|>"] for lang in LANGUAGES}

    def unload(self) -> None:
        self._encoder = self._decoder = None

    def probabilities(self, samples: np.ndarray, candidates: list[str]) -> dict[str, float]:
        """Each candidate's probability for these samples; they sum to 1."""
        if self._decoder is None:
            raise RuntimeError("language identification not loaded")
        mel = log_mel(samples, window_samples(len(samples)))
        if not self._lanes.acquire(timeout=self._lane_wait_ms / 1000):
            raise SttBusyError(f"language identification saturated: no lane within {self._lane_wait_ms:.0f}ms")
        try:
            hidden = self._encoder.run(None, {"input_features": mel})[0]
            logits = self._decoder.run(
                None,
                {"input_ids": np.array([[self._sot]], dtype=np.int64), "encoder_hidden_states": hidden},
            )[0][0, -1]
        finally:
            self._lanes.release()
        picked = np.array([logits[self._ids[lang]] for lang in candidates], dtype=np.float64)
        picked = np.exp(picked - picked.max())
        return dict(zip(candidates, (picked / picked.sum()).tolist()))
