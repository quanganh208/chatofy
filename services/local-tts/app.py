"""Local TTS HTTP sidecar.

Wraps Kokoro-82M (sherpa-onnx) behind a tiny FastAPI service so the NestJS API
can synthesize English speech over localhost, with no cloud call. The model is
loaded once at startup and kept warm; a lock serializes inference since the CPU
engine is a shared, blocking resource.

English only by design — Vietnamese synthesis stays with the VieNeu sidecar,
which uses a different runtime. Model choice comes from the measured comparison
in plans/reports/tts-en-cpu-benchmark-260718-results-report.md.
"""
import os

# ONNX Runtime sizes its thread pool at import time, so this must be set before
# anything pulls in the engine — 8 (physical cores) beat 16 (hyperthreads).
_threads = os.environ.get("LOCAL_TTS_THREADS", "8")
os.environ.setdefault("OMP_NUM_THREADS", _threads)
os.environ.setdefault("MKL_NUM_THREADS", _threads)

import io  # noqa: E402
from contextlib import asynccontextmanager  # noqa: E402

import soundfile as sf  # noqa: E402
from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.responses import JSONResponse, Response  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from engines.kokoro_en import KokoroEn  # noqa: E402

#: The `af` blend that won the A/B listening test.
DEFAULT_SID = int(os.environ.get("LOCAL_TTS_VOICE_ID", "0"))
SUPPORTED_LANGUAGE = "en"

engine = KokoroEn()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    engine.load()
    try:
        yield
    finally:
        pass


app = FastAPI(title="local-tts-sidecar", lifespan=lifespan)


class SynthesizeRequest(BaseModel):
    text: str
    language: str = SUPPORTED_LANGUAGE
    #: Kokoro speaker id as a string — the TtsProvider contract carries `voice`
    #: as a string, so parsing and bounds-checking belong here.
    voice: str | None = None
    speed: float = 1.0


def _resolve_sid(voice: str | None) -> int:
    """Map the contract's string voice to a Kokoro speaker id.

    Anything unparseable or out of range falls back to the default rather than
    failing: /translate is a public API, and a bad voice should not cost the
    caller their audio.
    """
    if voice is None:
        return DEFAULT_SID
    try:
        sid = int(voice)
    except ValueError:
        return DEFAULT_SID
    return sid if 0 <= sid < engine.num_speakers else DEFAULT_SID


@app.get("/healthz")
def healthz() -> JSONResponse:
    ready = engine.loaded
    return JSONResponse(
        {"status": "ok" if ready else "loading"}, status_code=200 if ready else 503
    )


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest) -> Response:
    if not engine.loaded:
        raise HTTPException(status_code=503, detail="model not loaded")
    if req.language != SUPPORTED_LANGUAGE:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported language {req.language!r}; this service synthesizes English only",
        )
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is empty")

    samples, sample_rate = engine.synthesize(text, _resolve_sid(req.voice), req.speed)

    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV", subtype="PCM_16")
    return Response(content=buf.getvalue(), media_type="audio/wav")
