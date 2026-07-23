"""Integration tests for the local STT sidecar.

These load the real ONNX models (needs scripts/download_models.py to have run),
so they are integration-level, not unit. Set LOCAL_STT_SKIP_MODEL_TESTS=1 to
skip on machines without the weights cached.

Transcript *content* is not asserted here: the fixture is a synthetic sweep, not
speech, so an empty transcript is a correct result. Real-speech accuracy is
covered by the benchmark harness and by manual verification.
"""
import os

import pytest
from fastapi.testclient import TestClient

from app import app

pytestmark = pytest.mark.skipif(
    os.environ.get("LOCAL_STT_SKIP_MODEL_TESTS") == "1",
    reason="model tests skipped via LOCAL_STT_SKIP_MODEL_TESTS",
)


@pytest.fixture(scope="module")
def client():
    # `with` triggers lifespan → loads both models once for the whole module.
    with TestClient(app) as c:
        yield c


def test_healthz_ok(client):
    res = client.get("/healthz")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


@pytest.mark.parametrize("language", ["vi", "en"])
def test_transcribe_returns_text_field(client, webm_audio, language):
    res = client.post(
        "/transcribe",
        files={"file": ("audio.webm", webm_audio, "audio/webm")},
        data={"language": language},
    )
    assert res.status_code == 200
    body = res.json()
    assert isinstance(body["text"], str)
    assert body["language"] == language


def test_unsupported_language_400(client, webm_audio):
    res = client.post(
        "/transcribe",
        files={"file": ("audio.webm", webm_audio, "audio/webm")},
        data={"language": "fr"},
    )
    assert res.status_code == 400


def test_undecodable_audio_400(client):
    res = client.post(
        "/transcribe",
        files={"file": ("audio.webm", b"not audio at all", "audio/webm")},
        data={"language": "vi"},
    )
    assert res.status_code == 400


def test_missing_language_422(client, webm_audio):
    # FastAPI validation rejects the missing form field before our handler runs.
    res = client.post(
        "/transcribe",
        files={"file": ("audio.webm", webm_audio, "audio/webm")},
    )
    assert res.status_code == 422
