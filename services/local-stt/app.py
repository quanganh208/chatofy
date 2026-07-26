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

from fastapi import FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from audio.decode import AudioTooLongError, DecodeError, decode_to_16k_mono  # noqa: E402
from engines.registry import EngineRegistry, UnsupportedLanguageError  # noqa: E402

registry = EngineRegistry()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    registry.load_all()
    try:
        yield
    finally:
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
) -> dict:
    if not registry.ready:
        raise HTTPException(status_code=503, detail="models not loaded")

    # Reject an unusable language before spending time on decoding.
    try:
        engine = registry.get(language)
    except UnsupportedLanguageError as err:
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
