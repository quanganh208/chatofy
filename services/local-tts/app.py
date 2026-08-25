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
from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.responses import JSONResponse, Response  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from engines.registry import EngineRegistry, UnsupportedLanguageError  # noqa: E402

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


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest) -> Response:
    if not registry.ready:
        raise HTTPException(status_code=503, detail="models not loaded")

    try:
        engine = registry.get(req.language)
    except UnsupportedLanguageError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is empty")

    samples, sample_rate = engine.synthesize(text, req.gender, req.speed, req.voice)

    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV", subtype="PCM_16")
    return Response(content=buf.getvalue(), media_type="audio/wav")
