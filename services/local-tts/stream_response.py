"""HTTP side of a synthesis stream: headers after the first chunk, stop on exit.

Two rules carry the design, and both came from reviewing what a naive
`StreamingResponse(generator)` would do here:

**Headers wait for audio.** Starlette sends status and headers before it pulls
the first body chunk. Sent that early, a 200 would leave the API's first-byte
deadline measuring nothing, while the real wait — for the engine lock, which a
whole-turn stream holds — happened afterwards and looked like a stalled body.
Pulling the first chunk first also means an early failure (lock wait exceeded,
engine error) still gets a real status code, instead of a 200 whose body stops.

**Stopping never waits for garbage collection.** A client that disconnects makes
the send fail, and an async generator that is abandoned mid-iteration is only
finalized when the collector gets to it. So the worker is stopped in the
response's own `finally`, which runs however the response ends.
"""
from collections.abc import AsyncIterator

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

from stream_worker import StreamWorker


async def first_item(worker: StreamWorker, request: Request):
    """The worker's first item, or None if the client left while waiting.

    Polls rather than blocking in one thread call, because a blocked threadpool
    call cannot be interrupted: a request queued behind a long stream would keep
    waiting on a lock nobody wants any more. Between polls it checks for a
    disconnect and gives up.
    """
    while True:
        item = await run_in_threadpool(worker.get)
        if item is not None:
            return item
        if await request.is_disconnected():
            return None


async def _remaining_chunks(worker: StreamWorker, first: bytes) -> AsyncIterator[bytes]:
    yield first
    while True:
        item = await run_in_threadpool(worker.get)
        if item is None:
            continue
        kind, value = item
        if kind == "chunk":
            yield value
        elif kind == "end":
            return
        else:
            # Raised, not swallowed: ending the body cleanly would tell the
            # caller a truncated turn was complete. An exception here leaves the
            # chunked body unterminated, which the client reads as a failure.
            raise value


class PcmStreamResponse(StreamingResponse):
    """Raw pcm16 body fed by a worker that is stopped however the response ends."""

    def __init__(self, worker: StreamWorker, first: bytes, sample_rate: int):
        super().__init__(
            _remaining_chunks(worker, first),
            media_type="application/octet-stream",
            headers={
                "X-Sample-Rate": str(sample_rate),
                "X-Audio-Encoding": "pcm16",
            },
        )
        self._worker = worker

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            self._worker.stop()
