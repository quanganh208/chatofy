"""Mandarin on the shared Kokoro instance: catalog, one lock, reload.

Loads the real Kokoro model (needs scripts/download_models.py to have run). Set
LOCAL_TTS_SKIP_MODEL_TESTS=1 to skip on machines without it.
"""
import os
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app import app
from engines import kokoro_runtime
from engines.kokoro_en import KokoroEn
from engines.kokoro_zh import KokoroZh
from engines.registry import EngineRegistry
from engines.vieneu_vi import VieNeuVi

pytestmark = pytest.mark.skipif(
    os.environ.get("LOCAL_TTS_SKIP_MODEL_TESTS") == "1",
    reason="model tests skipped via LOCAL_TTS_SKIP_MODEL_TESTS",
)


def is_wav(body: bytes) -> bool:
    return len(body) > 44 and body[:4] == b"RIFF" and body[8:12] == b"WAVE"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_healthz_lists_zh(client):
    assert "zh" in client.get("/healthz").json()["languages"]


def test_zh_voices_are_the_chinese_speakers_without_46(client):
    voices = client.get("/voices?language=zh").json()["voices"]
    assert {v["token"] for v in voices} == {"45", "47", "48", "49", "50", "51", "52"}


def test_en_voices_are_still_the_us_block(client):
    voices = client.get("/voices?language=en").json()["voices"]
    assert {v["token"] for v in voices} == {str(i) for i in range(20)}


def test_a_percentage_in_chinese_synthesizes(client):
    res = client.post("/synthesize", json={"text": "今年增长了15%。", "language": "zh"})
    assert res.status_code == 200
    assert is_wav(res.content)


def test_the_zh_engine_reads_digits_as_chinese_words():
    assert KokoroZh().prepare("今年增长了15%。") == "今年增长了百分之十五。"
    # The en engine reads its text as given: no zh rule may reach English.
    assert KokoroEn().prepare("room 402 at 10:30") == "room 402 at 10:30"


def test_the_runtime_loads_no_rule_fst():
    # Every zh FST sherpa-onnx ships rewrites English digits, and rule FSTs
    # apply to all text the shared instance reads.
    assert kokoro_runtime.RULE_FSTS == ()
    assert "lexicon-zh.txt" in kokoro_runtime.LEXICONS


def test_en_and_zh_share_one_instance_and_one_lock(client):
    from app import registry

    en, zh = registry.get("en"), registry.get("zh")
    assert en._engine is zh._engine
    assert en._lock is zh._lock
    # VieNeu runs its own runtime, so it keeps a lock of its own.
    assert registry.get("vi")._lock is not en._lock


def test_concurrent_en_and_zh_synthesis_never_overlap(client, monkeypatch):
    from app import registry

    en, zh = registry.get("en"), registry.get("zh")
    inside = 0
    overlaps = []
    guard = threading.Lock()
    real_generate = en._engine.generate

    class CountingTts:
        sample_rate = en._engine.sample_rate

        def generate(self, *args, **kwargs):
            nonlocal inside
            with guard:
                inside += 1
                overlaps.append(inside)
            time.sleep(0.05)
            try:
                return real_generate(*args, **kwargs)
            finally:
                with guard:
                    inside -= 1

    counting = CountingTts()
    monkeypatch.setattr(en, "_engine", counting)
    monkeypatch.setattr(zh, "_engine", counting)
    threads = [
        threading.Thread(target=en.synthesize, args=("Hello there.",)),
        threading.Thread(target=zh.synthesize, args=("你好。",)),
        threading.Thread(target=en.synthesize, args=("Good morning.",)),
        threading.Thread(target=zh.synthesize, args=("早上好。",)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert overlaps and max(overlaps) == 1


def test_unload_all_then_load_all_leaves_both_engines_working(monkeypatch):
    # A runtime of its own, so the app client above holding the shared one
    # cannot keep the count from reaching zero.
    monkeypatch.setattr(kokoro_runtime, "RUNTIME", kokoro_runtime.KokoroRuntime())
    registry = EngineRegistry()
    registry.load_all()
    first = registry.get("en")._engine
    registry.unload_all()
    assert kokoro_runtime.RUNTIME._tts is None
    registry.load_all()
    en, zh = registry.get("en"), registry.get("zh")
    assert en._engine is zh._engine is not first
    assert len(en.synthesize("Hello.")[0]) > 0
    assert len(zh.synthesize("你好。")[0]) > 0
    registry.unload_all()


def test_vieneu_keeps_a_lock_of_its_own():
    assert VieNeuVi()._lock is not kokoro_runtime.RUNTIME.lock
    assert KokoroEn()._lock is KokoroZh()._lock is kokoro_runtime.RUNTIME.lock
