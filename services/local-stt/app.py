"""Local STT HTTP sidecar.

Wraps sherpa-onnx behind a tiny FastAPI service so the NestJS API can transcribe
Vietnamese and English speech over localhost, with no cloud call. Both models are
loaded once at startup and kept warm; each engine serializes its own inference
because the CPU recognizer is a shared, blocking resource.

Model choices come from the measured comparison in
docs/development-journey.md.
"""
import os

# ONNX Runtime sizes its thread pool at import time, so these must be set before
# anything pulls in the engines — 8 (physical cores) beat 16 (hyperthreads).
_threads = os.environ.get("LOCAL_STT_THREADS", "8")
os.environ.setdefault("OMP_NUM_THREADS", _threads)
os.environ.setdefault("MKL_NUM_THREADS", _threads)

from contextlib import asynccontextmanager  # noqa: E402

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from audio.decode import (  # noqa: E402
    AudioTooLongError,
    DecodeError,
    decode_to_16k_mono,
    pcm16_to_float32,
)
from engines.registry import (  # noqa: E402
    EngineRegistry,
    UnknownEngineError,
    UnsupportedLanguageError,
)
from streaming_sessions import (  # noqa: E402
    ChunkTooLargeError,
    StreamingSessions,
    StreamingUnsupportedError,
    TooManyStreamsError,
    UnknownStreamError,
)

registry = EngineRegistry()
streams = StreamingSessions()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    registry.load_all()
    try:
        yield
    finally:
        # Sessions first: they hold decoder state belonging to the engines below,
        # and freeing the engines out from under a live stream is a native crash
        # rather than an exception.
        streams.close_all()
        registry.unload_all()


app = FastAPI(title="local-stt-sidecar", lifespan=lifespan)


@app.get("/healthz")
def healthz() -> JSONResponse:
    ready = registry.ready
    return JSONResponse(
        {"status": "ok" if ready else "loading"}, status_code=200 if ready else 503
    )


@app.post("/transcribe")
def transcribe(
    file: UploadFile = File(...),
    language: str = Form(...),
    # Which engine, when the caller has a role in mind. The on-screen transcript
    # asks for the accurate one; the spoken path does not come here at all.
    # Absent means the language's default.
    engine_name: str | None = Form(default=None, alias="engine"),
) -> dict:
    if not registry.ready:
        raise HTTPException(status_code=503, detail="models not loaded")

    # Reject an unusable language before spending time on decoding.
    try:
        engine = registry.get(language, engine_name)
    except UnsupportedLanguageError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except UnknownEngineError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    try:
        samples = decode_to_16k_mono(file.file.read())
    except AudioTooLongError as err:
        raise HTTPException(status_code=413, detail=str(err)) from err
    except DecodeError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    # Sync endpoint runs in FastAPI's threadpool; the engine's own lock
    # serializes concurrent calls against the single warm recognizer.
    return {"text": engine.transcribe(samples), "language": language}


# ---------------------------------------------------------------------------
# Causal decoding sessions.
#
# The path that speaks while the speaker is still talking. Separate from
# /transcribe rather than a flag on it because the two answer different
# questions: /transcribe asks "what does this audio say", and is free to change
# its mind on the next call; a session asks "what is newly certain", and its
# answer is played aloud before the next chunk arrives.
# ---------------------------------------------------------------------------


@app.post("/stream")
def open_stream(language: str = Form(...)) -> dict:
    if not registry.ready:
        raise HTTPException(status_code=503, detail="models not loaded")
    try:
        # The SPOKEN engine, explicitly. An unnamed request gets the accurate
        # one, which is right for every reader and wrong for the only caller here.
        engine = registry.spoken(language)
    except UnsupportedLanguageError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    try:
        stream_id = streams.open(engine, language)
    except StreamingUnsupportedError as err:
        # 409 rather than 400: the request is well formed and the language is
        # served, but not in this mode. A caller must be able to tell "you asked
        # wrong" from "this deployment cannot do that", because only the second
        # is a reason to fall back to whole-utterance decoding.
        raise HTTPException(status_code=409, detail=str(err)) from err
    except TooManyStreamsError as err:
        # 429, not 503: the service is healthy and the caller may try again.
        raise HTTPException(status_code=429, detail=str(err)) from err
    return {"stream_id": stream_id, "language": language}


@app.post("/stream/{stream_id}/feed")
def feed_stream(stream_id: str, chunk: bytes = Body(...)) -> dict:
    """Push raw PCM16 mono at 16 kHz; get back only what it finalized."""
    try:
        samples = pcm16_to_float32(chunk)
    except DecodeError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    try:
        return {"text": streams.feed(stream_id, samples)}
    except ChunkTooLargeError as err:
        raise HTTPException(status_code=413, detail=str(err)) from err
    except UnknownStreamError as err:
        raise HTTPException(status_code=404, detail="no such stream") from err


@app.post("/stream/{stream_id}/finalize")
def finalize_stream(stream_id: str) -> dict:
    """Flush the decoder's tail. The session stays open until deleted."""
    try:
        return {"text": streams.finalize(stream_id)}
    except UnknownStreamError as err:
        raise HTTPException(status_code=404, detail="no such stream") from err


@app.delete("/stream/{stream_id}")
def close_stream(stream_id: str) -> dict:
    try:
        streams.close(stream_id)
    except UnknownStreamError as err:
        raise HTTPException(status_code=404, detail="no such stream") from err
    return {"closed": stream_id}
