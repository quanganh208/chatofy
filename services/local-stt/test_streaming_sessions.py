"""The session store, driven against a fake engine.

No weights and no HTTP: what is tested here is the bookkeeping that decides
whether 60MB of decoder state is freed, and that has to be provable on a machine
with no models cached. The real decoder is exercised through the routes in
`test_app.py`.
"""
import threading
import time

import numpy as np
import pytest

from streaming_sessions import (
    StreamingSessions,
    StreamingUnsupportedError,
    UnknownStreamError,
)


class FakeStream:
    def __init__(self) -> None:
        self.fed: list[int] = []
        self.closed = 0
        self.finalized = 0
        #: Set by a test that cares what the text looks like, not how long it is.
        self.next_delta: str | None = None

    def feed(self, samples):
        self.fed.append(len(samples))
        if self.next_delta is not None:
            return self.next_delta, 0
        return f"<{len(samples)}>", 0

    def finalize(self):
        self.finalized += 1
        return "<tail>"

    def close(self):
        self.closed += 1


class FakeEngine:
    lang = "vi"
    supports_streaming = True

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.streams: list[FakeStream] = []

    def stream(self):
        created = FakeStream()
        self.streams.append(created)
        return created

    def postprocess(self, text: str) -> str:
        # Stands in for the language-tag filter, which must reach every delta —
        # a tag left in one chunk is a tag spoken aloud. Trims like the real one
        # does, so a store that reached for it on a delta would show up here.
        return text.replace("<", "[").replace(">", "]").strip()

    def postprocess_delta(self, text: str) -> str:
        # The delta form keeps the edges: the space in front of a word is the
        # only thing that stops it being glued onto the previous one.
        return text.replace("<", "[").replace(">", "]")


class OfflineEngine(FakeEngine):
    supports_streaming = False

    def stream(self):
        raise AssertionError("must never be called for a non-streaming engine")


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def engine() -> FakeEngine:
    return FakeEngine()


def test_feed_returns_the_delta_through_postprocess(engine):
    sessions = StreamingSessions()
    stream_id = sessions.open(engine, "vi")

    text = sessions.feed(stream_id, np.zeros(4, dtype=np.float32))

    assert text == "[4]"
    assert engine.streams[0].fed == [4]


def test_feed_keeps_the_space_a_delta_begins_with(engine):
    # The store must reach for the DELTA cleanup, not the whole-text one. The
    # difference is a word boundary: a caller appends what it gets back, so a
    # trimmed leading space turns "làm" + " người" into "làmngười" — which was
    # translated and spoken that way, and counted as a contradiction against a
    # word already committed.
    sessions = StreamingSessions()
    stream_id = sessions.open(engine, "vi")
    engine.streams[0].next_delta = " người"

    assert sessions.feed(stream_id, np.zeros(4, dtype=np.float32)) == " người"


def test_finalize_flushes_the_tail_and_leaves_the_session_open(engine):
    sessions = StreamingSessions()
    stream_id = sessions.open(engine, "vi")

    assert sessions.finalize(stream_id) == "[tail]"
    # Still usable, and still counted: finalize flushes the decoder, it does not
    # release the memory. Only close does, and conflating them would leak.
    assert sessions.count == 1
    sessions.close(stream_id)
    assert sessions.count == 0
    assert engine.streams[0].closed == 1


def test_a_non_streaming_engine_is_refused_rather_than_faked(engine):
    # The caller intends to SPEAK this. An engine that re-decodes would hand it
    # text a later read can revise, so saying no is the only honest answer.
    sessions = StreamingSessions()
    with pytest.raises(StreamingUnsupportedError):
        sessions.open(OfflineEngine(), "vi")


@pytest.mark.parametrize("call", ["feed", "finalize", "close"])
def test_unknown_ids_raise_rather_than_pass_silently(engine, call):
    sessions = StreamingSessions()
    with pytest.raises(UnknownStreamError):
        if call == "feed":
            sessions.feed("nope", np.zeros(4, dtype=np.float32))
        elif call == "finalize":
            sessions.finalize("nope")
        else:
            sessions.close("nope")


def test_an_abandoned_session_is_reaped_and_its_decoder_freed(engine):
    """The leak this store exists to prevent.

    A client that closes its browser mid-turn never calls close, and cannot be
    detected from here. Without this the 60MB it pinned is held until restart.
    """
    clock = FakeClock()
    sessions = StreamingSessions(clock=clock, ttl=30.0)
    stream_id = sessions.open(engine, "vi")

    clock.now += 31.0
    assert sessions.reap() == 1
    assert sessions.count == 0
    assert engine.streams[0].closed == 1
    with pytest.raises(UnknownStreamError):
        sessions.feed(stream_id, np.zeros(4, dtype=np.float32))


def test_feeding_keeps_a_session_alive(engine):
    """A live turn must never be reaped. Expiring one costs a transcript that
    stops mid-sentence with nothing on screen explaining it."""
    clock = FakeClock()
    sessions = StreamingSessions(clock=clock, ttl=30.0)
    stream_id = sessions.open(engine, "vi")

    for _ in range(5):
        clock.now += 20.0
        sessions.feed(stream_id, np.zeros(4, dtype=np.float32))

    assert sessions.count == 1
    assert sessions.reap() == 0


def test_shutdown_frees_every_session(engine):
    sessions = StreamingSessions()
    for _ in range(3):
        sessions.open(engine, "vi")

    sessions.close_all()

    assert sessions.count == 0
    assert [stream.closed for stream in engine.streams] == [1, 1, 1]


def test_concurrent_feeds_on_one_session_do_not_interleave(engine):
    """Decoder state is not transactional; overlapping feeds would corrupt the
    continuity the session exists to provide."""
    order: list[str] = []
    barrier = threading.Event()

    class BlockingStream(FakeStream):
        def feed(self, samples):
            order.append("enter")
            barrier.wait(timeout=1.0)
            order.append("exit")
            return "", 0

    engine.stream = lambda: BlockingStream()  # type: ignore[method-assign]
    sessions = StreamingSessions()
    stream_id = sessions.open(engine, "vi")

    first = threading.Thread(
        target=sessions.feed, args=(stream_id, np.zeros(4, dtype=np.float32))
    )
    first.start()
    # Wait for the first feed to be INSIDE the lock. A busy-wait here pins a core
    # and, on a single-core runner, can starve the very thread it waits for.
    deadline = time.monotonic() + 2.0
    while not order and time.monotonic() < deadline:
        time.sleep(0.001)
    second = threading.Thread(
        target=sessions.feed, args=(stream_id, np.zeros(4, dtype=np.float32))
    )
    second.start()
    barrier.set()
    first.join(timeout=2.0)
    second.join(timeout=2.0)

    # Never enter/enter/exit/exit: the second feed waited for the first to leave.
    assert order == ["enter", "exit", "enter", "exit"]
