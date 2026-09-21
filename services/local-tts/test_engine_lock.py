"""The real `TtsEngine` lock, and the 503 a busy engine answers with — no models.

`test_stream_worker.py` drives a fake stream with its own lock, so it cannot
see `TtsEngine.stream`'s wait loop. These tests subclass the real engine with a
fake runtime, which puts the lock scope, the bounded wait, a caller leaving
while queued, and the `X-Engine-Busy` marker under test on a machine without
the weights.
"""
import threading
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

import app as sidecar
import engines.base as base
from engines.base import EngineBusyError, TtsEngine

CHUNK = np.full(480, 0.25, dtype=np.float32)


class FakeEngine(TtsEngine):
    lang = "vi"
    VOICES = {"female": "f", "male": "m"}

    def __init__(self, chunks: int = 3) -> None:
        super().__init__()
        self._engine = object()
        self.chunks = chunks

    def load(self) -> None:
        pass

    @property
    def sample_rate(self) -> int:
        return 24000

    def _infer(self, text, voice, speed):
        return CHUNK, self.sample_rate

    def _infer_stream(self, text, voice, speed):
        for _ in range(self.chunks):
            yield CHUNK


class PerChunkEngine(FakeEngine):
    HOLDS_LOCK_FOR_TURN = False


def open_stream(engine: TtsEngine, *, lock_timeout: float = 0.3, should_stop=lambda: False):
    return engine.stream(
        "text", None, 1.0, None, lock_timeout=lock_timeout, should_stop=should_stop
    )


def test_a_turn_stream_holds_the_lock_between_chunks_and_releases_it_at_the_end():
    engine = FakeEngine()
    stream = open_stream(engine)
    next(stream)
    assert engine._lock.locked()
    assert len(list(stream)) == engine.chunks - 1
    assert not engine._lock.locked()


def test_closing_a_turn_stream_mid_way_releases_the_lock():
    engine = FakeEngine()
    stream = open_stream(engine)
    next(stream)
    stream.close()
    assert not engine._lock.locked()


def test_a_second_turn_gives_up_with_engine_busy_after_its_wait():
    engine = FakeEngine()
    first = open_stream(engine)
    next(first)

    started = time.monotonic()
    with pytest.raises(EngineBusyError):
        next(open_stream(engine, lock_timeout=0.3))
    assert 0.25 <= time.monotonic() - started < 2.0
    first.close()


def test_a_caller_that_leaves_while_queued_stops_waiting_without_taking_the_lock():
    engine = FakeEngine()
    engine._lock.acquire()
    gone = threading.Event()
    threading.Timer(0.1, gone.set).start()
    try:
        started = time.monotonic()
        assert list(open_stream(engine, lock_timeout=5.0, should_stop=gone.is_set)) == []
        assert time.monotonic() - started < 1.0
    finally:
        engine._lock.release()


def test_a_per_chunk_engine_lets_a_second_turn_in_between_chunks():
    engine = PerChunkEngine()
    first = open_stream(engine)
    next(first)
    assert not engine._lock.locked()
    # Would raise EngineBusyError on a whole-turn engine (see above).
    assert len(list(open_stream(engine))) == engine.chunks
    assert len(list(first)) == engine.chunks - 1
    assert not engine._lock.locked()


def test_whole_wav_synthesis_waits_less_than_the_apis_deadline(monkeypatch):
    assert base.SYNTHESIZE_LOCK_WAIT_S < 15.0
    monkeypatch.setattr(base, "SYNTHESIZE_LOCK_WAIT_S", 0.2)
    engine = FakeEngine()
    engine._lock.acquire()
    try:
        with pytest.raises(EngineBusyError):
            engine.synthesize("text")
    finally:
        engine._lock.release()


class ReadyRegistry:
    def __init__(self, engine: TtsEngine) -> None:
        self.engine = engine
        self.ready = True

    def get(self, lang: str) -> TtsEngine:
        return self.engine


@pytest.fixture
def busy_client(monkeypatch):
    """The app with one engine whose lock another turn is holding.

    No `with`: lifespan would load the real models, and none are needed here.
    """
    engine = FakeEngine()
    monkeypatch.setattr(sidecar, "registry", ReadyRegistry(engine))
    monkeypatch.setattr(sidecar, "ENGINE_LOCK_WAIT_S", 0.3)
    monkeypatch.setattr(base, "SYNTHESIZE_LOCK_WAIT_S", 0.3)
    engine._lock.acquire()
    try:
        yield TestClient(sidecar.app)
    finally:
        engine._lock.release()


@pytest.mark.parametrize("path", ["/synthesize", "/synthesize/stream"])
def test_a_busy_engine_answers_503_marked_busy(busy_client, path):
    res = busy_client.post(path, json={"text": "Xin chào.", "language": "vi"})
    assert res.status_code == 503
    assert res.headers.get("x-engine-busy") == "1"


def test_a_sidecar_that_is_not_ready_answers_503_without_the_busy_marker(monkeypatch):
    registry = ReadyRegistry(FakeEngine())
    registry.ready = False
    monkeypatch.setattr(sidecar, "registry", registry)
    res = TestClient(sidecar.app).post("/synthesize/stream", json={"text": "Hi."})
    assert res.status_code == 503
    assert "x-engine-busy" not in res.headers
