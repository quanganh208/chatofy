"""Local TTS HTTP sidecar.

Synthesizes both output languages over localhost, with no cloud call: English
through Kokoro-82M (sherpa-onnx) and Vietnamese through VieNeu v3 Turbo. Two
runtimes, one service — the split that matters to callers is the function
(speech synthesis), not which library performs it.

Both voices load once at startup and stay warm; each serializes its own
inference because the CPU engines are shared, blocking resources.

Model choices come from the measured comparisons in
plans/reports/tts-en-cpu-benchmark-260718-results-report.md.
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
from pydantic import BaseModel  # noqa: E402

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
    #: Kokoro speaker id for English, VieNeu preset name for Vietnamese.
    #: Each engine interprets it and falls back to its own default.
    voice: str | None = None
    speed: float = 1.0


@app.get("/healthz")
def healthz() -> JSONResponse:
    ready = registry.ready
    return JSONResponse(
        {"status": "ok" if ready else "loading"}, status_code=200 if ready else 503
    )


@app.get("/voices")
def voices(language: str = "vi") -> dict:
    """Selectable voice names for a language. Empty for engines that address
    voices by id (English) rather than by name."""
    if not registry.ready:
        raise HTTPException(status_code=503, detail="models not loaded")
    try:
        return {"language": language, "voices": registry.voices(language)}
    except UnsupportedLanguageError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


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

    samples, sample_rate = engine.synthesize(text, req.voice, req.speed)

    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV", subtype="PCM_16")
    return Response(content=buf.getvalue(), media_type="audio/wav")
