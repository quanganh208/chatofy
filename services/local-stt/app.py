"""Local STT HTTP sidecar.

Wraps sherpa-onnx behind a tiny FastAPI service so the NestJS API can transcribe
Vietnamese and English speech over localhost, with no cloud call. Both models are
loaded once at startup and kept warm; each engine serves several decodes at once
through a lane semaphore and refuses (503) rather than queues once every lane
has been busy past the wait budget — see engines/base.py for the measurements.

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
from audio.speech_duration import speech_duration_ms  # noqa: E402
from engines.base import SttBusyError  # noqa: E402
from engines.registry import (  # noqa: E402
    EngineRegistry,
    UnsupportedLanguageError,
    UnsupportedPassError,
)
from hotwords import build_hotwords  # noqa: E402
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
    # Repeated form fields rather than one delimited string: sherpa-onnx
    # separates hotwords with "/", and a caller's term containing one would
    # silently become two terms instead of being rejected or escaped.
    hotwords: list[str] = Form(default=[]),
    # "partial" for a live re-read of a turn still being spoken, "final" for
    # the settled transcript. Defaults to final so a caller that predates the
    # field keeps getting the best transcript rather than the cheapest one.
    pass_: str = Form(default="final", alias="pass"),
) -> dict:
    if not registry.ready:
        raise HTTPException(status_code=503, detail="models not loaded")

    # Reject an unusable language or pass before spending time on decoding.
    try:
        engine = registry.get(language, pass_)
    except (UnsupportedLanguageError, UnsupportedPassError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    try:
        samples = decode_to_16k_mono(file.file.read())
    except AudioTooLongError as err:
        raise HTTPException(status_code=413, detail=str(err)) from err
    except DecodeError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    # Sync endpoint runs in FastAPI's threadpool; the engine's lanes bound how
    # many decodes overlap. Saturation is a refusal, not a queue: a caller
    # waiting on a turn would rather hear 503 now than an answer too late to
    # speak. (The api maps this to ProviderResponseError and fails its turn.)
    # Empty for a request that named nothing, which is what keeps an ordinary
    # turn on the decoder every published number for this model was measured
    # with. An engine that cannot be biased is handed nothing either way.
    terms = build_hotwords(hotwords) if engine.supports_hotwords else ""

    try:
        text = engine.transcribe(samples, terms)
    except SttBusyError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    return {"text": text, "language": language}


@app.post("/embed")
def embed(file: UploadFile = File(...)) -> dict:
    """One utterance in, one unit-norm speaker vector out, and how much voice it heard.

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
    # Measured here rather than by the caller, off the samples that produced the
    # vector, because this is the only place both exist. The API holds encoded
    # bytes, and the duration the browser could report is buffer time — pre-roll
    # and hangover counted as speech. A caller deciding whether the vector
    # carries any speaker information at all needs the speech. On the
    # conversation this was measured against the two differ by more than a factor
    # of two on exactly the turns where the difference decides the answer.
    return {
        "vector": vector,
        "dim": len(vector),
        "speechMs": speech_duration_ms(samples),
    }
