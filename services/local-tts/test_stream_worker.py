"""The stream worker's own guarantees, without models or sockets.

Everything here is about the engine lock coming back, driven with a fake
engine stream so each case is exact and fast.
"""
import threading
import time

import numpy as np

import stream_worker
from stream_worker import StreamDeadlineError, StreamWorker, to_pcm16


class FakeEngine:
    """An engine stream holding a real lock, like `TtsEngine.stream`."""

    def __init__(self, chunks: int, delay_s: float = 0.0):
        self.lock = threading.Lock()
        self.chunks = chunks
        self.delay_s = delay_s
        self.produced = 0

    def stream(self, should_stop):
        self.lock.acquire()
        try:
            for _ in range(self.chunks):
                if self.delay_s:
                    time.sleep(self.delay_s)
                self.produced += 1
                yield np.full(480, 0.5, dtype=np.float32)
        finally:
            self.lock.release()


def drain(worker: StreamWorker, limit_s: float = 5.0) -> list:
    items, deadline = [], time.monotonic() + limit_s
    while time.monotonic() < deadline:
        item = worker.get(timeout=0.05)
        if item is None:
            continue
        items.append(item)
        if item[0] != "chunk":
            break
    return items


def wait_until(condition, limit_s: float = 5.0) -> bool:
    deadline = time.monotonic() + limit_s
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.02)
    return False


def test_delivers_every_chunk_then_ends_and_releases():
    engine = FakeEngine(chunks=3)
    worker = StreamWorker(engine.stream)
    worker.start()

    items = drain(worker)

    assert [kind for kind, _ in items] == ["chunk", "chunk", "chunk", "end"]
    assert items[0][1] == to_pcm16(np.full(480, 0.5, dtype=np.float32))
    assert wait_until(lambda: not worker.alive)
    assert engine.lock.acquire(blocking=False)


def test_stop_releases_the_lock_at_the_next_chunk():
    engine = FakeEngine(chunks=1000, delay_s=0.01)
    worker = StreamWorker(engine.stream)
    worker.start()
    assert worker.get(timeout=2)[0] == "chunk"

    worker.stop()

    assert wait_until(lambda: not worker.alive)
    assert engine.lock.acquire(blocking=False)
    assert engine.produced < 1000


def test_a_reader_that_never_takes_chunks_releases_the_lock(monkeypatch):
    monkeypatch.setattr(stream_worker, "READER_STALL_S", 0.3)
    engine = FakeEngine(chunks=1000)
    worker = StreamWorker(engine.stream)
    worker.start()

    # Nobody calls get(): the queue fills, the put times out, the worker quits.
    assert wait_until(lambda: not worker.alive)
    assert engine.lock.acquire(blocking=False)
    assert engine.produced <= stream_worker.QUEUE_SIZE + 2


def test_a_stream_past_its_deadline_is_cut_off(monkeypatch):
    monkeypatch.setattr(stream_worker, "STREAM_DEADLINE_S", 0.1)
    engine = FakeEngine(chunks=1000, delay_s=0.02)
    worker = StreamWorker(engine.stream)
    worker.start()

    items = drain(worker)

    assert items[-1][0] == "error"
    assert isinstance(items[-1][1], StreamDeadlineError)
    assert wait_until(lambda: not worker.alive)
    assert engine.lock.acquire(blocking=False)


def test_an_engine_error_reaches_the_reader():
    def broken(should_stop):
        yield np.zeros(10, dtype=np.float32)
        raise RuntimeError("engine fell over")

    worker = StreamWorker(broken)
    worker.start()

    items = drain(worker)

    assert [kind for kind, _ in items] == ["chunk", "error"]
    assert str(items[-1][1]) == "engine fell over"


def test_pcm16_clips_rather_than_wrapping():
    pcm = to_pcm16(np.array([2.0, -2.0, 0.0], dtype=np.float32))
    assert np.frombuffer(pcm, dtype="<i2").tolist() == [32767, -32767, 0]


def test_a_reader_of_a_worker_that_stopped_hears_an_error_not_silence():
    # Stopped without a final item — the case that left the HTTP response
    # polling an empty queue forever.
    engine = FakeEngine(chunks=1000, delay_s=0.01)
    worker = StreamWorker(engine.stream)
    worker.start()
    worker.stop()
    assert wait_until(lambda: not worker.alive)

    items = drain(worker)

    assert items and items[-1][0] == "error"
    assert isinstance(items[-1][1], stream_worker.StreamStoppedError)


def test_the_deadline_does_not_count_the_wait_for_the_engine(monkeypatch):
    monkeypatch.setattr(stream_worker, "STREAM_DEADLINE_S", 0.2)

    def queued_then_quick(should_stop):
        time.sleep(0.4)  # waiting on another turn's lock
        for _ in range(3):
            yield np.zeros(10, dtype=np.float32)

    worker = StreamWorker(queued_then_quick)
    worker.start()

    assert [kind for kind, _ in drain(worker)] == ["chunk", "chunk", "chunk", "end"]
