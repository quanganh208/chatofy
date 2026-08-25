"""Integration tests for POST /embed.

Loads the real model, like `test_app.py`, and skips with the same env var.

**What these do not test: whether the embeddings tell people apart.** That is a
property of the model on real speech, and it was measured properly — 100k
embeddings against a Vietnamese corpus, reported as an equal-error rate per
duration and room condition. The fixture here is a synthetic sweep, so a test
built on it could only assert something weaker while looking like it covered the
same ground. What it can prove is that the endpoint reads the audio it was given
and returns a vector shaped the way every caller assumes, which is the half the
benchmark cannot see.
"""
import concurrent.futures
import math
import os

import pytest
from fastapi.testclient import TestClient

from app import app
from conftest import make_webm_opus

pytestmark = pytest.mark.skipif(
    os.environ.get("LOCAL_STT_SKIP_MODEL_TESTS") == "1",
    reason="model tests skipped via LOCAL_STT_SKIP_MODEL_TESTS",
)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def other_audio() -> bytes:
    """A different signal, so "did it read the input" can be answered at all."""
    return make_webm_opus(duration_s=2.0)


def post_embed(client, audio: bytes):
    return client.post("/embed", files={"file": ("audio.webm", audio, "audio/webm")})


def test_returns_a_vector_of_the_models_dimension(client, webm_audio):
    res = post_embed(client, webm_audio)

    assert res.status_code == 200
    body = res.json()
    assert body["dim"] == len(body["vector"]) > 0
    assert all(isinstance(value, float) for value in body["vector"])


def test_the_vector_is_unit_norm(client, webm_audio):
    # Normalized here so no caller has to remember to. An unnormalized vector
    # reaching a cosine threshold does not raise — it returns a number, and the
    # wrong one, for as long as nobody checks.
    vector = post_embed(client, webm_audio).json()["vector"]

    assert math.isclose(math.sqrt(sum(value * value for value in vector)), 1.0, rel_tol=1e-5)


def test_the_same_audio_gives_the_same_vector(client, webm_audio):
    first = post_embed(client, webm_audio).json()["vector"]
    second = post_embed(client, webm_audio).json()["vector"]

    assert first == second


def test_different_audio_gives_a_different_vector(client, webm_audio, other_audio):
    # The guard against a mis-wired stream: one that never received the waveform
    # would return the same vector for everything, and every other assertion here
    # would still pass.
    assert post_embed(client, webm_audio).json()["vector"] != post_embed(
        client, other_audio
    ).json()["vector"]


def test_undecodable_audio_is_a_client_error(client):
    res = client.post("/embed", files={"file": ("audio.webm", b"not audio", "audio/webm")})

    assert res.status_code == 400


def test_concurrent_calls_do_not_corrupt_each_other(client, webm_audio, other_audio):
    # The extractor holds one warm sherpa-onnx object behind one lock. Without
    # it, two overlapping requests interleave on a shared stream and both get a
    # vector built from a mixture — which is a plausible-looking number, not a
    # crash.
    expected = {
        "a": post_embed(client, webm_audio).json()["vector"],
        "b": post_embed(client, other_audio).json()["vector"],
    }
    audio = {"a": webm_audio, "b": other_audio}

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = {
            key: [pool.submit(post_embed, client, audio[key]) for _ in range(4)]
            for key in audio
        }
        for key, pending in futures.items():
            for future in pending:
                assert future.result().json()["vector"] == expected[key]


def test_embedding_and_transcribing_at_once_both_succeed(client, webm_audio):
    # Separate locks, so neither waits on the other. If this ever deadlocks or
    # serializes, the second HTTP request the caller pays for has stopped buying
    # anything.
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        embedding = pool.submit(post_embed, client, webm_audio)
        transcript = pool.submit(
            client.post,
            "/transcribe",
            files={"file": ("audio.webm", webm_audio, "audio/webm")},
            data={"language": "vi"},
        )
        assert embedding.result().status_code == 200
        assert transcript.result().status_code == 200


def test_healthz_covers_the_extractor(client):
    # A sidecar reporting ok while it cannot embed would have callers finding out
    # one turn at a time.
    assert client.get("/healthz").json()["status"] == "ok"
