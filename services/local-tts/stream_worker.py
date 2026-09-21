"""Drive one synthesis stream on its own thread, and make sure it ends.

`TtsEngine.stream` holds the engine lock for the whole turn, so everything here
exists to guarantee that lock comes back: when synthesis finishes, when it
fails, when the client disconnects, when the stream outruns its deadline, and
when the client stays connected but stops reading (see READER_STALL_S for how
rarely that last one is reached over TCP). A lock that leaked would silence that
language for every user until the process restarted.

The shape that makes it safe is ownership. One worker thread iterates the engine
generator from first frame to `close()`, so the lock is acquired and released on
the same thread, and releasing it never depends on garbage collection or on
which threadpool thread happens to resume a generator. The HTTP side only reads
from a bounded queue and sets a stop flag.
"""
import queue
import threading
import time
from collections.abc import Callable, Iterator

import numpy as np

#: Hard ceiling on one stream's synthesis time, counted from its first chunk.
#: A turn is at most 60 s of speech
#: and VieNeu runs at RTF ~0.5-0.65, so a stream still going after this long is
#: pathological, and it is holding the lock every other turn in its language needs.
STREAM_DEADLINE_S = 60.0

#: How long a queued chunk may wait for the client to take it. A reader that
#: falls this far behind is not coming back, and the lock is worth more.
#:
#: This fires only once backpressure reaches the queue, and over TCP it does
#: not reach it quickly: the kernel's socket buffers on both ends absorb several
#: megabytes first — measured on localhost, a client that stopped reading
#: never blocked a 50-second turn at 48 kHz at all. In practice a stalled reader
#: is bounded by STREAM_DEADLINE_S, and by the API's own total deadline, which
#: fires sooner. This guard is for the reader that stalls on a long enough
#: stream to fill those buffers.
READER_STALL_S = 5.0

#: Chunks buffered between synthesis and the socket. Enough to ride out a slow
#: send; small enough that a stalled reader is noticed within READER_STALL_S.
QUEUE_SIZE = 8

#: Granularity at which a blocked put or get re-checks the stop flag.
POLL_S = 0.25


class StreamDeadlineError(Exception):
    """The stream outran STREAM_DEADLINE_S and was cut off."""


class StreamStoppedError(Exception):
    """The worker ended without a final item: it was stopped, or gave up."""


def to_pcm16(samples: np.ndarray) -> bytes:
    """Float samples in [-1, 1] as little-endian 16-bit PCM, clipped."""
    clipped = np.clip(samples, -1.0, 1.0)
    return (clipped * 32767.0).astype("<i2").tobytes()


class StreamWorker:
    """Owns one engine stream. Items come out of `get` as:

    - `("chunk", bytes)`: pcm16 audio, never empty;
    - `("end", None)`: synthesis finished normally;
    - `("error", exc)`: synthesis failed, including `EngineBusyError` while
      queued and `StreamDeadlineError`.
    """

    def __init__(self, open_stream: Callable[[Callable[[], bool]], Iterator[np.ndarray]]):
        # Called on the worker thread with `should_stop`, so the engine's lock
        # wait can be abandoned by a caller that left while queued.
        self._open_stream = open_stream
        self._queue: queue.Queue = queue.Queue(maxsize=QUEUE_SIZE)
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True, name="tts-stream")

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        """Ask the worker to finish. Safe to call any number of times."""
        self._stop.set()

    @property
    def alive(self) -> bool:
        return self._thread.is_alive()

    def get(self, timeout: float = POLL_S):
        """Next item, or None if nothing arrived within `timeout`.

        A worker that stopped without a final item — told to stop, or given up
        on a reader that stalled — would otherwise leave its reader polling an
        empty queue forever. Once the thread is gone and the queue is drained,
        that silence is reported as the error it is.
        """
        try:
            return self._queue.get(timeout=timeout)
        except queue.Empty:
            pass
        if self._thread.is_alive():
            return None
        try:
            # The thread may have queued its last item after the wait above.
            return self._queue.get_nowait()
        except queue.Empty:
            return ("error", StreamStoppedError("stream stopped before it finished"))

    def _put(self, item) -> bool:
        """Queue an item unless the reader is gone. False means stop producing."""
        waited = 0.0
        while not self._stop.is_set():
            try:
                self._queue.put(item, timeout=POLL_S)
                return True
            except queue.Full:
                waited += POLL_S
                if waited >= READER_STALL_S:
                    self._stop.set()
        return False

    def _run(self) -> None:
        # Counted from the first chunk, not from the start: the wait for the
        # engine lock has its own bound, and charging it here would cut a turn
        # that queued behind another one short of its own 60 seconds.
        deadline = None
        stream = None
        try:
            stream = self._open_stream(self._stop.is_set)
            for samples in stream:
                if self._stop.is_set():
                    return
                deadline = deadline or time.monotonic() + STREAM_DEADLINE_S
                if time.monotonic() > deadline:
                    raise StreamDeadlineError(
                        f"stream exceeded {STREAM_DEADLINE_S:g}s and was cut off"
                    )
                if len(samples) == 0:
                    continue
                if not self._put(("chunk", to_pcm16(samples))):
                    return
            self._put(("end", None))
        except Exception as err:  # noqa: BLE001 — every failure must reach the reader
            self._put(("error", err))
        finally:
            # On THIS thread, which is the one that acquired the lock inside the
            # generator. `close()` raises GeneratorExit at the paused `yield`, and
            # the engine's `finally` releases the lock.
            if stream is not None:
                stream.close()
