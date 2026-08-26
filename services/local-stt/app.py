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
from speaker.embedder import SpeakerEmbedder  # noqa: E402

registry = EngineRegistry()
embedder = SpeakerEmbedder()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Order matters and is not cosmetic: `load_all` runs the onnxruntime preload
    # that must precede any `import sherpa_onnx`, and the extractor's load does
    # import it. Reversed, the process aborts with no Python traceback.
    registry.load_all()
    embedder.load()
    try:
        yield
    finally:
        embedder.unload()
        registry.unload_all()


app = FastAPI(title="local-stt-sidecar", lifespan=lifespan)


@app.get("/healthz")
def healthz() -> JSONResponse:
    # The extractor counts towards readiness. A sidecar reporting ok while it
    # cannot embed would have callers discovering that one turn at a time.
    ready = registry.ready and embedder.loaded
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


@app.post("/embed")
def embed(file: UploadFile = File(...)) -> dict:
    """One utterance in, one unit-norm speaker vector out.

    Separate from `/transcribe` rather than a flag on it, and the reason is
    ordering rather than tidiness. Translation cannot start until it has the
    transcript text, so an embedding riding along in that response would land
    its cost BEFORE the translation instead of beside it. A second localhost
    upload of a few-second clip costs single-digit milliseconds; the merge would
    buy a serialization to save roughly nothing.

    No `language` field: the model is trained across languages and the caller
    would only be guessing anyway on a turn nobody has transcribed yet.
    """
    if not embedder.loaded:
        raise HTTPException(status_code=503, detail="speaker extractor not loaded")

    # Same decoder and the same two failures as /transcribe. The length cap is
    # inherited deliberately rather than tuned for this endpoint: a turn is a few
    # seconds, so nothing here approaches it, and a second limit to keep in step
    # would be a second thing to get wrong.
    try:
        samples = decode_to_16k_mono(file.file.read())
    except AudioTooLongError as err:
        raise HTTPException(status_code=413, detail=str(err)) from err
    except DecodeError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    vector = embedder.embed(samples)
    return {"vector": vector, "dim": len(vector)}
