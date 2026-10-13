"""Kokoro multi-lang packages (v1_0 fp32, v1_1-zh int8) via sherpa-onnx OfflineTts.

One class, several configurations, because the question the zh benchmark asks is
about configuration, not about a different runtime:

- `kokoro-v1_0-en-only` is the sidecar's shipped config today
  (`services/local-tts/engines/kokoro_en.py`): `lexicon-us-en.txt` alone.
- `kokoro-v1_0-en-zh` is the same model with the zh frontend added, which is how
  one shared instance would serve both languages: both lexicons and the three
  zh rule FSTs (date, phone, number). jieba's `dict/` is NOT passed: sherpa-onnx
  1.13.4 says at validate time that since v1.12.15 Kokoro ignores `dict_dir`,
  so passing it would change nothing but add a warning.
- `kokoro-v1_1-int8-zh` is the v1.1-zh package with the same frontend.

The speaker id is a constructor argument: one instance is one speaker for the
duration of a run, so the result file and the WAV directory are per speaker.
Speaker ids come from the model's own `id2speaker` metadata, read in
`SPEAKER_NAMES` below, so a name in the report is never a guess.
"""

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..measure import BENCH_ROOT, MODELS_DIR, bench_threads, preload_onnxruntime_dll
from .base import TtsEngine

#: Read-only: the sidecar's on-disk v1_0 package. Never written by the bench.
V1_0_DIR = BENCH_ROOT.parent.parent / "services" / "local-tts" / "models" / "kokoro-multi-lang-v1_0"
V1_1_DIR = MODELS_DIR / "kokoro-int8-multi-lang-v1_1"
SPEED = 1.0
ZH_RULE_FSTS = ("date-zh.fst", "phone-zh.fst", "number-zh.fst")


@dataclass(frozen=True)
class KokoroConfig:
    model_dir: Path
    model_file: str
    asset: str
    lexicons: tuple[str, ...]
    rule_fsts: tuple[str, ...]
    #: speaker id -> name, from the model's `id2speaker` metadata (subset used here).
    speaker_names: dict[int, str]


_V1_0_NAMES = {
    9: "af_sarah", 11: "am_adam",
    45: "zf_xiaobei", 46: "zf_xiaoni", 47: "zf_xiaoxiao", 48: "zf_xiaoyi",
    49: "zm_yunjian", 50: "zm_yunxi", 51: "zm_yunxia", 52: "zm_yunyang",
}
_V1_1_NAMES = {
    3: "zf_001", 4: "zf_002", 5: "zf_003", 6: "zf_004",
    58: "zm_009", 59: "zm_010", 60: "zm_011", 61: "zm_012",
}

CONFIGS: dict[str, KokoroConfig] = {
    "kokoro-v1_0-en-only": KokoroConfig(
        V1_0_DIR, "model.onnx", "kokoro-multi-lang-v1_0.tar.bz2",
        ("lexicon-us-en.txt",), (), _V1_0_NAMES,
    ),
    "kokoro-v1_0-en-zh": KokoroConfig(
        V1_0_DIR, "model.onnx", "kokoro-multi-lang-v1_0.tar.bz2",
        ("lexicon-us-en.txt", "lexicon-zh.txt"), ZH_RULE_FSTS, _V1_0_NAMES,
    ),
    "kokoro-v1_1-int8-zh": KokoroConfig(
        V1_1_DIR, "model.int8.onnx", "kokoro-int8-multi-lang-v1_1.tar.bz2",
        ("lexicon-us-en.txt", "lexicon-zh.txt"), ZH_RULE_FSTS, _V1_1_NAMES,
    ),
}


class SherpaKokoroMulti(TtsEngine):
    def __init__(self, engine_id: str, sid: int) -> None:
        if engine_id not in CONFIGS:
            raise KeyError(f"unknown Kokoro config {engine_id!r}; known: {sorted(CONFIGS)}")
        self._cfg = CONFIGS[engine_id]
        if sid not in self._cfg.speaker_names:
            raise ValueError(
                f"sid {sid} not benchmarked for {engine_id}; known: {sorted(self._cfg.speaker_names)}"
            )
        self.engine_id = engine_id
        self.sid = sid
        self._tts = None
        self._threads = bench_threads()

    @property
    def speaker_name(self) -> str:
        return self._cfg.speaker_names[self.sid]

    def load(self) -> None:
        preload_onnxruntime_dll()
        import sherpa_onnx

        d = self._cfg.model_dir
        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                    model=str(d / self._cfg.model_file),
                    voices=str(d / "voices.bin"),
                    tokens=str(d / "tokens.txt"),
                    lexicon=",".join(str(d / f) for f in self._cfg.lexicons),
                    data_dir=str(d / "espeak-ng-data"),
                ),
                num_threads=self._threads,
                provider="cpu",
            ),
            rule_fsts=",".join(str(d / f) for f in self._cfg.rule_fsts),
        )
        if not config.validate():
            raise RuntimeError(f"invalid Kokoro config {self.engine_id} — check {d}")
        self._tts = sherpa_onnx.OfflineTts(config)

    def synthesize(self, text: str) -> tuple[np.ndarray, int]:
        audio = self._tts.generate(text, sid=self.sid, speed=SPEED)
        return np.asarray(audio.samples, dtype=np.float32), audio.sample_rate

    def decode_params(self) -> dict:
        return {
            "model": f"k2-fsa/sherpa-onnx tts-models/{self._cfg.asset}",
            "model_file": self._cfg.model_file,
            "lexicons": list(self._cfg.lexicons),
            "rule_fsts": list(self._cfg.rule_fsts),
            "sid": self.sid,
            "speaker": self.speaker_name,
            "speed": SPEED,
            "num_threads": self._threads,
        }
