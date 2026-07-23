"""Vietnamese TTS — VieNeu v3 Turbo (ONNX/CPU, torch-free).

Different runtime from the English voice: the `vieneu` package owns its own
inference stack, so this engine does not touch sherpa-onnx. Cold start is
~8s and the first ever run downloads the model.

Voices are preset names ("Phạm Tuyên", …), not speaker ids — the web app's
voice picker sends these for en→vi. An unknown name falls back to the default
rather than failing the turn.
"""
import os

import numpy as np

from .base import TtsEngine

DEFAULT_VOICE = os.environ.get("LOCAL_TTS_VOICE_VI", "Phạm Tuyên")


class VieNeuVi(TtsEngine):
    lang = "vi"

    def load(self) -> None:
        from vieneu import Vieneu

        self._engine = Vieneu(mode="v3turbo")  # CPU → torch-free ONNX

    @property
    def preset_voices(self) -> list[str]:
        if self._engine is None:
            return []
        return list(getattr(self._engine, "_preset_voices", {}).keys())

    def _resolve_voice(self, voice: str | None) -> str:
        if voice and voice in self.preset_voices:
            return voice
        return DEFAULT_VOICE

    def _infer(self, text: str, voice: str | None, speed: float) -> tuple[np.ndarray, int]:
        # VieNeu has no speed control; `speed` is accepted for contract
        # symmetry with the English engine and ignored here.
        samples = np.asarray(
            self._engine.infer(text, voice=self._resolve_voice(voice)), dtype=np.float32
        )
        return samples, self._engine.sample_rate
