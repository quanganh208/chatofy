"""Mandarin TTS — Kokoro-82M v1_0's Chinese speakers on the shared instance.

Chosen over Kokoro v1_1-zh int8 (benchmarks/tts, zh-r1): v1_1 was not better
by the 2-point margin under both judges, and costs a second model and RTF
1.25-1.36 against v1_0's 0.30-0.33. Defaults by round-trip CER over 30
conversational sentences (SenseVoice / Paraformer judge): 47 zf_xiaoxiao
1.8% / 2.9%, 51 zm_yunxia 2.0% / 2.2%.

Text passes through `verbalize_zh` first: the instance loads no rule FSTs (they
rewrite English digits too), so digits are spoken words before Kokoro sees them.

Known limitation: Latin acronyms are spelled letter by letter ("ChatGPT").
"""
from .base import VoiceEntry
from .kokoro_runtime import SharedKokoroEngine
from .zh_number_verbalizer import verbalize_zh


class KokoroZh(SharedKokoroEngine):
    lang = "zh"
    VOICES = {"female": 47, "male": 51}
    #: Kokoro's Chinese speakers, ids from the model's own `id2speaker` metadata.
    #:
    #: 46 (zf_xiaoni) is left out: it read with wrong tones, round-trip CER
    #: 25-30% under both judges where every other voice stayed under 5%.
    CATALOG = (
        VoiceEntry(token="45", label="Xiaobei", gender="female"),
        VoiceEntry(token="47", label="Xiaoxiao", gender="female"),
        VoiceEntry(token="48", label="Xiaoyi", gender="female"),
        VoiceEntry(token="49", label="Yunjian", gender="male"),
        VoiceEntry(token="50", label="Yunxi", gender="male"),
        VoiceEntry(token="51", label="Yunxia", gender="male"),
        VoiceEntry(token="52", label="Yunyang", gender="male"),
    )

    def prepare(self, text: str) -> str:
        return verbalize_zh(text)
