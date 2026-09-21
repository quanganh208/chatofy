"""Local TTS HTTP sidecar.

Synthesizes both output languages over localhost, with no cloud call: English
through Kokoro-82M (sherpa-onnx) and Vietnamese through VieNeu v3 Turbo. Two
runtimes, one service — the split that matters to callers is the function
(speech synthesis), not which library performs it.

Callers choose a voice by gender; each engine owns which of its own voices that
means. Both engines load once at startup and stay warm; each serializes its own
inference because the CPU engines are shared, blocking resources.

Model choices come from the measured comparisons in
docs/development-journey.md.
"""
import os

# ONNX Runtime sizes its thread pool at import time, so these must be set before
# anything pulls in the engines — 8 (physical cores) beat 16 (hyperthreads).
_threads = os.environ.get("LOCAL_TTS_THREADS", "8")
os.environ.setdefault("OMP_NUM_THREADS", _threads)
os.environ.setdefault("MKL_NUM_THREADS", _threads)

import io  # noqa: E402
from contextlib import asynccontextmanager  # noqa: E402

import soundfile as sf  # noqa: E402
from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.responses import JSONResponse, Response  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from engines.base import ENGINE_LOCK_WAIT_S, EngineBusyError, TtsEngine  # noqa: E402
from engines.registry import EngineRegistry, UnsupportedLanguageError  # noqa: E402
from stream_response import PcmStreamResponse, first_item  # noqa: E402
from stream_worker import StreamWorker  # noqa: E402

registry = EngineRegistry()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    registry.load_all()
    try:
        yield
    finally:
        registry.unload_all()


app = FastAPI(title="local-tts-sidecar", lifespan=lifespan)


class SynthesizeRequest(BaseModel):
    text: str
    language: str = "en"
    #: "female" or "male". Left as a plain string rather than a Literal so an
    #: unrecognised value falls back inside the engine instead of 422-ing a
    #: turn that could still have been spoken.
    gender: str | None = None
    #: Bounded HERE, not only in the app's schema one service away. This sidecar
    #: takes no authentication of its own and serializes every synthesis behind a
    #: single engine lock, so it is the component a bad value actually costs:
    #: `speed=0.001` asks the model for roughly a thousand times the audio for one
    #: clause while holding that lock, and `speed=0` is undefined. Unlike `gender`
    #: above there is no sensible fallback for a number, so this one does 422 —
    #: a rate outside these bounds cannot have been meant.
    speed: float = Field(1.0, ge=0.5, le=2.0)
    #: A specific voice from `GET /voices`, taking precedence over `gender` when
    #: this engine recognises it. Length-bounded here; whether the token is real
    #: is a question only the engine can answer, and it answers by falling back
    #: rather than failing — see `TtsEngine._resolve`.
    voice: str | None = Field(default=None, max_length=64)


class StreamSynthesizeRequest(SynthesizeRequest):
    #: Capped on the stream endpoint only, because only there does one request
    #: hold the engine for the whole text: every other turn in this language
    #: waits behind it. 2000 characters is well past a 60-second turn's
    #: translation, so this bounds the pathological case, not real speech.
    text: str = Field(max_length=2000)


@app.get("/voices")
def voices(language: str = "en") -> JSONResponse:
    """The voices this deployment can actually speak, for the caller to choose from.

    Discovered at runtime rather than published as a static list, because which
    voices exist is a property of the engine that happens to be loaded. A client
    that hardcoded them would be wrong the moment the backend changed — which is
    the mistake that once took Vietnamese synthesis down entirely.
    """
    try:
        engine = registry.get(language)
    except UnsupportedLanguageError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    return JSONResponse(
        {
            "voices": [
                {"token": entry.token, "label": entry.label, "gender": entry.gender}
                for entry in engine.CATALOG
            ]
        }
    )


@app.get("/healthz")
def healthz() -> JSONResponse:
    ready = registry.ready
    return JSONResponse(
        {"status": "ok" if ready else "loading"}, status_code=200 if ready else 503
    )


def _engine_and_text(req: SynthesizeRequest) -> tuple[TtsEngine, str]:
    """The checks both synthesis endpoints make before any audio exists."""
    if not registry.ready:
        raise HTTPException(status_code=503, detail="models not loaded")

    try:
        engine = registry.get(req.language)
    except UnsupportedLanguageError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is empty")
    return engine, text


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest) -> Response:
    engine, text = _engine_and_text(req)
    try:
        samples, sample_rate = engine.synthesize(text, req.gender, req.speed, req.voice)
    except EngineBusyError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err

    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV", subtype="PCM_16")
    return Response(content=buf.getvalue(), media_type="audio/wav")


@app.post("/synthesize/stream")
async def synthesize_stream(req: StreamSynthesizeRequest, request: Request) -> Response:
    """The whole turn as raw pcm16, sent as the engine produces it.

    Each engine decides how to cut the text: VieNeu streams frames, Kokoro
    streams clauses. Status and headers go out only once the first chunk exists
    (see `stream_response`), so every failure before the first sample still
    gets a real status code.
    """
    engine, text = _engine_and_text(req)

    worker = StreamWorker(
        lambda should_stop: engine.stream(
            text,
            req.gender,
            req.speed,
            req.voice,
            lock_timeout=ENGINE_LOCK_WAIT_S,
            should_stop=should_stop,
        )
    )
    worker.start()
    try:
        first = await first_item(worker, request)
    except BaseException:
        worker.stop()
        raise

    if first is None:
        # The caller is gone; nobody will read whatever status this is.
        worker.stop()
        return Response(status_code=499)

    kind, value = first
    if kind == "error":
        worker.stop()
        busy = isinstance(value, EngineBusyError)
        raise HTTPException(status_code=503 if busy else 500, detail=str(value))
    if kind == "end":
        # The text held nothing speakable (punctuation alone, say): a complete,
        # empty stream rather than a failure.
        return Response(
            content=b"",
            media_type="application/octet-stream",
            headers={"X-Sample-Rate": str(engine.sample_rate), "X-Audio-Encoding": "pcm16"},
        )
    return PcmStreamResponse(worker, value, engine.sample_rate)
