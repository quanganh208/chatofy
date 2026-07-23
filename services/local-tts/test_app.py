"""Integration tests for the local TTS sidecar.

These load the real ONNX model (needs scripts/download_models.py to have run),
so they are integration-level, not unit. Set LOCAL_TTS_SKIP_MODEL_TESTS=1 to
skip on machines without the weights cached.
"""
import os

import pytest
from fastapi.testclient import TestClient

from app import app

pytestmark = pytest.mark.skipif(
    os.environ.get("LOCAL_TTS_SKIP_MODEL_TESTS") == "1",
    reason="model tests skipped via LOCAL_TTS_SKIP_MODEL_TESTS",
)


@pytest.fixture(scope="module")
def client():
    # `with` triggers lifespan → loads the model once for the whole module.
    with TestClient(app) as c:
        yield c


def test_healthz_ok(client):
    res = client.get("/healthz")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_synthesize_returns_wav(client):
    res = client.post("/synthesize", json={"text": "Hello, this is a test."})
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/wav"
    body = res.content
    assert len(body) > 44  # more than a bare WAV header
    assert body[:4] == b"RIFF" and body[8:12] == b"WAVE"


def test_synthesize_empty_text_400(client):
    res = client.post("/synthesize", json={"text": "   "})
    assert res.status_code == 400


def test_non_english_language_400(client):
    # Vietnamese synthesis belongs to the VieNeu sidecar, not this one.
    res = client.post("/synthesize", json={"text": "Xin chào", "language": "vi"})
    assert res.status_code == 400


def test_out_of_range_voice_falls_back(client):
    # A bad voice must not cost the caller their audio.
    res = client.post("/synthesize", json={"text": "Hello there.", "voice": "9999"})
    assert res.status_code == 200
    assert res.content[:4] == b"RIFF"


def test_unparseable_voice_falls_back(client):
    res = client.post(
        "/synthesize", json={"text": "Hello there.", "voice": "Phạm Tuyên"}
    )
    assert res.status_code == 200
    assert res.content[:4] == b"RIFF"
