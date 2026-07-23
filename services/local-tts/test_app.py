"""Integration tests for the local TTS sidecar.

These load the real models (needs scripts/download_models.py to have run, and
the VieNeu weights cached), so they are integration-level, not unit. Set
LOCAL_TTS_SKIP_MODEL_TESTS=1 to skip on machines without them.
"""
import os

import pytest
from fastapi.testclient import TestClient

from app import app

pytestmark = pytest.mark.skipif(
    os.environ.get("LOCAL_TTS_SKIP_MODEL_TESTS") == "1",
    reason="model tests skipped via LOCAL_TTS_SKIP_MODEL_TESTS",
)


def is_wav(body: bytes) -> bool:
    return len(body) > 44 and body[:4] == b"RIFF" and body[8:12] == b"WAVE"


@pytest.fixture(scope="module")
def client():
    # `with` triggers lifespan → loads both voices once for the whole module.
    with TestClient(app) as c:
        yield c


def test_healthz_ok(client):
    res = client.get("/healthz")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_synthesize_english(client):
    res = client.post("/synthesize", json={"text": "Hello, this is a test."})
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/wav"
    assert is_wav(res.content)


def test_synthesize_vietnamese(client):
    res = client.post(
        "/synthesize", json={"text": "Xin chào, đây là bản thử.", "language": "vi"}
    )
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/wav"
    assert is_wav(res.content)


def test_synthesize_empty_text_400(client):
    res = client.post("/synthesize", json={"text": "   "})
    assert res.status_code == 400


def test_unsupported_language_400(client):
    res = client.post("/synthesize", json={"text": "Bonjour", "language": "fr"})
    assert res.status_code == 400


def test_out_of_range_english_voice_falls_back(client):
    # A bad voice must not cost the caller their audio.
    res = client.post("/synthesize", json={"text": "Hello there.", "voice": "9999"})
    assert res.status_code == 200
    assert is_wav(res.content)


def test_unknown_vietnamese_voice_falls_back(client):
    res = client.post(
        "/synthesize",
        json={"text": "Xin chào.", "language": "vi", "voice": "Không Tồn Tại"},
    )
    assert res.status_code == 200
    assert is_wav(res.content)


def test_english_voice_name_on_vietnamese_engine_falls_back(client):
    # Cross-language voice values are nonsense to the other engine; each must
    # degrade to its own default rather than error.
    res = client.post("/synthesize", json={"text": "Xin chào.", "language": "vi", "voice": "0"})
    assert res.status_code == 200
    assert is_wav(res.content)


def test_voices_lists_vietnamese_presets(client):
    res = client.get("/voices", params={"language": "vi"})
    assert res.status_code == 200
    body = res.json()
    assert body["language"] == "vi"
    assert isinstance(body["voices"], list) and body["voices"]


def test_voices_empty_for_english(client):
    # Kokoro addresses speakers by id, so there are no names to list.
    res = client.get("/voices", params={"language": "en"})
    assert res.status_code == 200
    assert res.json()["voices"] == []
