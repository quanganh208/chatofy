"""Integration tests for the local TTS sidecar.

These load the real models (needs scripts/download_models.py to have run, and
the VieNeu weights cached), so they are integration-level, not unit. Set
LOCAL_TTS_SKIP_MODEL_TESTS=1 to skip on machines without them.
"""
import os

import pytest
from fastapi.testclient import TestClient

from app import app
from engines.kokoro_en import KokoroEn
from engines.vieneu_vi import VieNeuVi

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


@pytest.mark.parametrize("language,text", [("en", "Hello there."), ("vi", "Xin chào.")])
@pytest.mark.parametrize("gender", ["female", "male"])
def test_synthesize_each_gender(client, language, text, gender):
    res = client.post(
        "/synthesize", json={"text": text, "language": language, "gender": gender}
    )
    assert res.status_code == 200
    assert is_wav(res.content)


@pytest.mark.parametrize("language", ["en", "vi"])
def test_unknown_gender_falls_back(client, language):
    # A bad gender must not cost the caller their audio.
    res = client.post(
        "/synthesize", json={"text": "Hello.", "language": language, "gender": "robot"}
    )
    assert res.status_code == 200
    assert is_wav(res.content)


@pytest.mark.parametrize("engine_type", [KokoroEn, VieNeuVi])
def test_every_engine_covers_both_genders(engine_type):
    # A missing entry would not fail — it would quietly serve the other gender,
    # so the catalog is asserted rather than left to a listening test.
    assert set(engine_type.VOICES) == {"female", "male"}


def test_genders_map_to_distinct_voices():
    assert KokoroEn.VOICES["female"] != KokoroEn.VOICES["male"]
    assert VieNeuVi.VOICES["female"] != VieNeuVi.VOICES["male"]
