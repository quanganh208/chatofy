"""English TTS — Kokoro-82M (Apache-2.0) via sherpa-onnx OfflineTts.

k2-fsa package kokoro-multi-lang-v1_0: model.onnx + voices.bin + tokens.txt +
espeak-ng-data + lexicons. Only the US English lexicon is wired up — the
package is multi-lingual, but this engine's language is fixed to `en` by the
registry, and sherpa-onnx refuses to load a v1.x model with no lexicon at all.

Measured on this machine over the benchmark's 30 sentences: mean 0.68s per
sentence, p95 0.86s, RTF 0.24, ~620MB peak RAM. Replaced kokoro-en-v0_19,
which was marginally slower and had a much worse tail (p95 up to 1.65s).
See docs/development-journey.md.
"""
import numpy as np

from .base import MODELS_DIR, TtsEngine, preload_onnxruntime_dll

MODEL_DIR = MODELS_DIR / "kokoro-multi-lang-v1_0"


class KokoroEn(TtsEngine):
    lang = "en"
    #: Kokoro speaker ids. The v1.0 package ships 53 voices ordered by voice
    #: name, which renumbered the two auditioned in v0_19: `af_sarah` moved
    #: from 3 to 9, `am_adam` from 5 to 11.
    VOICES = {"female": 9, "male": 11}

    def load(self) -> None:
        preload_onnxruntime_dll()
        import sherpa_onnx

        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                    model=str(MODEL_DIR / "model.onnx"),
                    voices=str(MODEL_DIR / "voices.bin"),
                    tokens=str(MODEL_DIR / "tokens.txt"),
                    lexicon=str(MODEL_DIR / "lexicon-us-en.txt"),
                    data_dir=str(MODEL_DIR / "espeak-ng-data"),
                ),
                num_threads=self._threads,
                provider="cpu",
            ),
        )
        # validate() returns False rather than raising on a bad path; skipping
        # this check turns a missing file into an obscure crash much later.
        if not config.validate():
            raise RuntimeError(
                f"invalid Kokoro config — check the model files in {MODEL_DIR}"
            )
        self._engine = sherpa_onnx.OfflineTts(config)

    def _infer(self, text: str, voice: int | str, speed: float) -> tuple[np.ndarray, int]:
        audio = self._engine.generate(text, sid=int(voice), speed=speed)
        return np.asarray(audio.samples, dtype=np.float32), audio.sample_rate
