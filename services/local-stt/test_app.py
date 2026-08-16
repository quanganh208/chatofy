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


def test_transcribe_accepts_a_named_engine(client, webm_audio):
    """The display path asks for the accurate Vietnamese engine by name."""
    res = client.post(
        "/transcribe",
        files={"file": ("audio.webm", webm_audio, "audio/webm")},
        data={"language": "vi", "engine": "zipformer"},
    )
    assert res.status_code == 200
    assert isinstance(res.json()["text"], str)


def test_unknown_engine_name_400(client, webm_audio):
    # Not a silent fallback: a caller that asked for the accurate engine and
    # quietly got the other one would produce a worse transcript with nothing
    # anywhere saying why.
    res = client.post(
        "/transcribe",
        files={"file": ("audio.webm", webm_audio, "audio/webm")},
        data={"language": "vi", "engine": "nope"},
    )
    assert res.status_code == 400


def test_a_streaming_session_decodes_causally_over_http(client):
    """The acceptance criterion of phase 2b, stated as a test.

    `engine.stream()` existed and was tested from Python since it was
    introduced, but nothing exposed it, so production re-decoded a growing
    window instead and paid the streaming engine's error rate for none of its
    behaviour. This test fails if that regresses, because it only passes if the
    running transcript is append-only across the whole session.
    """
    import numpy as np

    opened = client.post("/stream", data={"language": "vi"})
    assert opened.status_code == 200
    stream_id = opened.json()["stream_id"]

    # 300ms chunks, the cadence the commit path feeds at.
    chunk = (np.zeros(4800, dtype="<i2")).tobytes()
    running = ""
    snapshots = []
    for _ in range(6):
        res = client.post(f"/stream/{stream_id}/feed", content=chunk)
        assert res.status_code == 200
        running += res.json()["text"]
        snapshots.append(running)

    tail = client.post(f"/stream/{stream_id}/finalize")
    assert tail.status_code == 200

    violations = [
        i for i in range(1, len(snapshots)) if not snapshots[i].startswith(snapshots[i - 1])
    ]
    assert violations == [], "a feed revised text an earlier feed had emitted"

    assert client.delete(f"/stream/{stream_id}").status_code == 200
    # Gone means gone: the decoder state is freed, not parked.
    assert client.post(f"/stream/{stream_id}/finalize").status_code == 404


def test_streaming_is_refused_for_an_engine_that_cannot(client):
    """English is served by a whole-utterance engine, and saying so is the point
    — a caller must be able to tell "not in this mode" from "bad request"."""
    res = client.post("/stream", data={"language": "en"})
    assert res.status_code == 409


def test_feed_on_an_unknown_stream_404(client):
    res = client.post("/stream/does-not-exist/feed", content=b"\x00\x00")
    assert res.status_code == 404
