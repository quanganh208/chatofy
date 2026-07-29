"""Vietnamese TTS — VieNeu v3 Turbo (ONNX/CPU, torch-free).

Different runtime from the English voice: the `vieneu` package owns its own
inference stack, so this engine does not touch sherpa-onnx. Cold start is
~8s and the first ever run downloads the model.
"""
import numpy as np

from .base import TtsEngine


class VieNeuVi(TtsEngine):
    lang = "vi"
    #: VieNeu preset names, chosen by listening to all 14 presets the package
    #: ships. "Thanh Bình" reads as unisex and is male — these labels are
    #: audition results, not inferences from the names.
    VOICES = {"female": "Mai Anh", "male": "Thanh Bình"}

    def load(self) -> None:
        from vieneu import Vieneu

        self._engine = Vieneu(mode="v3turbo")  # CPU → torch-free ONNX

    def _infer(self, text: str, voice: int | str, speed: float) -> tuple[np.ndarray, int]:
        # VieNeu has no speed control; `speed` is accepted for contract
        # symmetry with the English engine and ignored here.
        samples = np.asarray(
            self._engine.infer(text, voice=str(voice)), dtype=np.float32
        )
        return samples, self._engine.sample_rate
