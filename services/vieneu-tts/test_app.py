"""Integration tests for the VieNeu-TTS sidecar.

These load the real ONNX engine (cold-start ~8s, first ever run downloads the
model), so they are integration-level, not unit. Set VIENEU_SKIP_MODEL_TESTS=1
to skip on machines/CI without the model cached.
"""
import os

import pytest
from fastapi.testclient import TestClient

from app import app

pytestmark = pytest.mark.skipif(
    os.environ.get("VIENEU_SKIP_MODEL_TESTS") == "1",
    reason="model tests skipped via VIENEU_SKIP_MODEL_TESTS",
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


def test_voices_lists_presets(client):
    res = client.get("/voices")
    assert res.status_code == 200
    body = res.json()
    assert isinstance(body["voices"], list) and body["voices"]
    assert body["default"]


def test_synthesize_returns_wav(client):
    res = client.post("/synthesize", json={"text": "Xin chào, đây là bản thử."})
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/wav"
    body = res.content
    assert len(body) > 44  # more than a bare WAV header
    assert body[:4] == b"RIFF" and body[8:12] == b"WAVE"


def test_synthesize_empty_text_400(client):
    res = client.post("/synthesize", json={"text": "   "})
    assert res.status_code == 400
