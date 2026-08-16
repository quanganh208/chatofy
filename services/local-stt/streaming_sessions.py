"""Causal decoding sessions, held across HTTP requests.

This is the piece that was missing. The Vietnamese engine has decoded causally
since it was introduced — `ParakeetStream` keeps decoder state across feeds, so
audio already consumed is never re-read and text already emitted can never be
revised — but nothing exposed it, so the service only ever offered whole-utterance
decoding and the commit path re-read a growing window instead. It paid the
streaming engine's error rate and got the non-streaming engine's behaviour.

A session is state the client owns and the server holds, which makes two things
mandatory rather than nice:

**Every session must be reclaimable without the client.** A session pins roughly
60MB of decoder state. A browser that closes mid-turn, a socket that drops, an
API that crashes — none of them will ever call close, and none of them can be
detected from here. So a session that has not been fed within {TTL_SECONDS} is
closed and LOGGED. Reaping happens on the way into every request rather than on
a timer: it needs no thread and no shutdown path, and the honest limit is that a
service which goes completely idle holds its last sessions until traffic
resumes. That memory is idle memory, and the next request frees it.

**Two feeds on one session must not overlap.** Decoder state is not
transactional; interleaved feeds would corrupt the very continuity the session
exists to provide. Each session carries its own lock, and the engine's lock is
taken underneath for the inference itself — the store's own lock is never held
across a decode, or one slow turn would stall every other turn's bookkeeping.
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field

import numpy as np

from engines.base import SttEngine

logger = logging.getLogger(__name__)

#: How long a session survives without being fed.
#:
#: Longer than a turn can possibly last, and that bound is the reason for the
#: number rather than the 300ms feed cadence. A client gates its own capture on
#: speech, so a live turn can go quiet for a long time and still be alive; the
#: server's own turn ceiling is 60s (`MAX_TURN_SECONDS`, `turn-audio.ts`), and
#: anything past that has been closed by the caller anyway.
#:
#: The asymmetry that sets the direction: expiring a LIVE session costs a turn
#: that stops transcribing mid-sentence with nothing on screen explaining it,
#: and it then fails in a way that stops the turn committing at all. Holding a
#: dead one costs 60MB until the next request. Those are not comparable.
TTL_SECONDS = 90.0

#: Most sessions open at once, before new ones are refused.
#:
#: The API holds at most `MAX_CONCURRENT_TURNS_GLOBAL` turns (6), so this is that
#: with headroom for a turn whose session has not been reaped yet. A ceiling
#: rather than none because `/transcribe` has had one from the start
#: (`LOCAL_STT_MAX_AUDIO_SECONDS`) and an unbounded route beside a bounded one is
#: the asymmetry that stops being local later — 60MB apiece is a whole machine at
#: a few hundred.
MAX_SESSIONS = 12

#: Longest chunk one feed may carry, in samples (60s at 16 kHz).
#:
#: The commit path sends 300ms. This is not sized for it; it is sized to refuse a
#: caller that sends a whole file, which would hold the engine lock for the
#: length of the decode and stall every other turn behind it.
MAX_FEED_SAMPLES = 16000 * 60


class TooManyStreamsError(Exception):
    """The session ceiling is reached. Maps to HTTP 429."""


class ChunkTooLargeError(Exception):
    """One feed carried more audio than a session accepts. Maps to HTTP 413."""


class UnknownStreamError(KeyError):
    """No such session: never opened, already closed, or reaped for silence."""


class StreamingUnsupportedError(Exception):
    """The engine serving this language decodes whole utterances only."""


@dataclass
class _Session:
    engine: SttEngine
    stream: object
    language: str
    touched: float
    lock: threading.Lock = field(default_factory=threading.Lock)


class StreamingSessions:
    """Every open decoding session, keyed by the id handed to the client."""

    def __init__(self, clock=time.monotonic, ttl: float = TTL_SECONDS) -> None:
        self._sessions: dict[str, _Session] = {}
        self._guard = threading.Lock()
        self._clock = clock
        self._ttl = ttl

    @property
    def count(self) -> int:
        with self._guard:
            return len(self._sessions)

    def open(self, engine: SttEngine, language: str) -> str:
        """Begin a session, or refuse if this engine cannot decode causally."""
        self.reap()
        if self.count >= MAX_SESSIONS:
            raise TooManyStreamsError(
                f"{MAX_SESSIONS} decoding sessions already open"
            )
        if not engine.supports_streaming:
            raise StreamingUnsupportedError(
                f"the {language!r} engine decodes whole utterances only; "
                "use /transcribe"
            )
        # Opening touches the model, so it takes the engine's lock like any
        # other inference would.
        with engine._lock:
            stream = engine.stream()
        stream_id = uuid.uuid4().hex
        with self._guard:
            self._sessions[stream_id] = _Session(
                engine=engine,
                stream=stream,
                language=language,
                touched=self._clock(),
            )
        return stream_id

    def feed(self, stream_id: str, samples: np.ndarray) -> str:
        """Push a chunk; return ONLY the text this chunk finalized.

        The delta, never the running transcript. That is the contract the engine
        offers and the one the commit path needs — a caller appends what it gets
        back and is guaranteed never to have to take any of it away again.
        """
        if len(samples) > MAX_FEED_SAMPLES:
            raise ChunkTooLargeError(
                f"a feed may carry at most {MAX_FEED_SAMPLES} samples"
            )
        self.reap()
        session = self._require(stream_id)
        with session.lock:
            with session.engine._lock:
                text, _events = session.stream.feed(samples)
            self._touch(stream_id)
        return session.engine.postprocess(text)

    def finalize(self, stream_id: str) -> str:
        """Flush the decoder's tail. The session stays open until closed."""
        self.reap()
        session = self._require(stream_id)
        with session.lock:
            with session.engine._lock:
                text = session.stream.finalize()
            self._touch(stream_id)
        return session.engine.postprocess(text)

    def close(self, stream_id: str) -> None:
        """Release a session. Unknown ids are an error, not a no-op: a caller
        closing something that is already gone has lost track of a turn, and
        swallowing that hides the leak this class exists to prevent."""
        with self._guard:
            session = self._sessions.pop(stream_id, None)
        if session is None:
            raise UnknownStreamError(stream_id)
        self._release(session)

    def close_all(self) -> None:
        """Shutdown. Nothing is logged: an intentional stop is not a leak."""
        with self._guard:
            sessions = list(self._sessions.values())
            self._sessions.clear()
        for session in sessions:
            self._release(session)

    def reap(self) -> int:
        """Close sessions nobody has fed within the TTL. Returns how many."""
        cutoff = self._clock() - self._ttl
        with self._guard:
            expired = [
                (key, session)
                for key, session in self._sessions.items()
                if session.touched < cutoff
            ]
            for key, _ in expired:
                del self._sessions[key]
        for key, session in expired:
            # Logged, not swallowed. A reap means a client vanished without
            # closing, and a service quietly cleaning up after that would hide
            # exactly the pattern worth knowing about.
            logger.warning(
                "reaped idle %s stream %s after %.0fs", session.language, key, self._ttl
            )
            self._release(session)
        return len(expired)

    def _require(self, stream_id: str) -> _Session:
        with self._guard:
            session = self._sessions.get(stream_id)
        if session is None:
            raise UnknownStreamError(stream_id)
        return session

    def _touch(self, stream_id: str) -> None:
        with self._guard:
            session = self._sessions.get(stream_id)
            if session is not None:
                session.touched = self._clock()

    def _release(self, session: _Session) -> None:
        """Free decoder state. Never raises — this runs on teardown paths where
        a failure would strand every session queued behind it."""
        try:
            with session.engine._lock:
                session.stream.close()
        except Exception:
            logger.exception("failed to close a %s stream", session.language)
