"""VieNeu-TTS HTTP sidecar.

Wraps the `vieneu` v3 Turbo (ONNX/CPU) engine behind a tiny FastAPI service so the
NestJS API can synthesize Vietnamese speech over localhost. The model is loaded
once at startup (cold-start ~8s) and kept warm; a lock serializes inference since
the CPU engine is a shared, blocking resource.
"""
import io
import os
import threading
from contextlib import asynccontextmanager

# ONNX Runtime honours these before it builds its thread pool — 8 (physical cores)
# beat 16 (hyperthreads) in the spike. Must be set before importing the engine.
_threads = os.environ.get("VIENEU_THREADS", "8")
os.environ.setdefault("OMP_NUM_THREADS", _threads)
os.environ.setdefault("MKL_NUM_THREADS", _threads)

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

DEFAULT_VOICE = os.environ.get("VIENEU_VOICE", "Phạm Tuyên")

# Engine + serialization lock live in module state; populated on startup.
_engine = {"tts": None}
_infer_lock = threading.Lock()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from vieneu import Vieneu

    _engine["tts"] = Vieneu(mode="v3turbo")  # CPU → torch-free ONNX
    try:
        yield
    finally:
        _engine["tts"] = None


app = FastAPI(title="vieneu-tts-sidecar", lifespan=lifespan)


class SynthesizeRequest(BaseModel):
    text: str
    voice: str | None = None


@app.get("/healthz")
def healthz() -> JSONResponse:
    ready = _engine["tts"] is not None
    return JSONResponse({"status": "ok" if ready else "loading"}, status_code=200 if ready else 503)


@app.get("/voices")
def voices() -> dict:
    tts = _engine["tts"]
    if tts is None:
        raise HTTPException(status_code=503, detail="model not loaded")
    names = list(getattr(tts, "_preset_voices", {}).keys())
    return {"default": getattr(tts, "_default_voice", None) or DEFAULT_VOICE, "voices": names}


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest) -> Response:
    tts = _engine["tts"]
    if tts is None:
        raise HTTPException(status_code=503, detail="model not loaded")
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is empty")

    voice = req.voice or DEFAULT_VOICE
    # Sync endpoint runs in FastAPI's threadpool; the lock serializes concurrent
    # calls so they don't contend on the single warm engine.
    with _infer_lock:
        audio = np.asarray(tts.infer(text, voice=voice), dtype=np.float32)

    buf = io.BytesIO()
    sf.write(buf, audio, tts.sample_rate, format="WAV", subtype="PCM_16")
    return Response(content=buf.getvalue(), media_type="audio/wav")
