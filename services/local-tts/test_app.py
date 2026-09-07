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


@pytest.mark.parametrize("speed", [0.4, 2.5, 0.0, -1.0])
def test_speed_outside_bounds_422(client, speed):
    # Unlike an unrecognised gender, a rate has no sensible fallback — and this
    # service is the one a bad value actually costs. It takes no auth of its own
    # and serializes every synthesis behind one engine lock, so `speed=0.001` asks
    # the model for roughly a thousand times the audio for one clause while holding
    # that lock. Bounding it one service away is not enough.
    res = client.post("/synthesize", json={"text": "Hello.", "speed": speed})
    assert res.status_code == 422


@pytest.mark.parametrize("speed", [0.5, 1.0, 2.0])
def test_speed_within_bounds_synthesizes(client, speed):
    res = client.post("/synthesize", json={"text": "Hello.", "speed": speed})
    assert res.status_code == 200
    assert is_wav(res.content)


def test_speed_is_optional(client):
    # Omitted means the engine's own natural pace; the app sends the field only
    # when the caller chose a rate.
    res = client.post("/synthesize", json={"text": "Hello."})
    assert res.status_code == 200
    assert is_wav(res.content)


@pytest.mark.parametrize("language,text", [("en", "Hello there."), ("vi", "Xin chào.")])
@pytest.mark.parametrize("gender", ["female", "male"])
def test_synthesize_each_gender(client, language, text, gender):
    res = client.post(
        "/synthesize", json={"text": text, "language": language, "gender": gender}
    )
    assert res.status_code == 200
    assert is_wav(res.content)


@pytest.mark.parametrize("language", ["en", "vi"])
def test_voices_lists_the_catalog(client, language):
    res = client.get(f"/voices?language={language}")
    assert res.status_code == 200
    voices = res.json()["voices"]
    assert len(voices) > 0
    for entry in voices:
        assert set(entry) == {"token", "label", "gender"}
        assert entry["gender"] in {"female", "male"}


def test_voices_unsupported_language_400(client):
    assert client.get("/voices?language=fr").status_code == 400


@pytest.mark.parametrize("language", ["en", "vi"])
def test_voice_tokens_are_unique(client, language):
    tokens = [v["token"] for v in client.get(f"/voices?language={language}").json()["voices"]]
    assert len(tokens) == len(set(tokens))


def test_english_catalog_is_the_us_block(client):
    # The ids are positions in Kokoro's alphabetical voice list, and these two are
    # the positions that were verified by listening. They are what pins the other
    # eighteen: an ordering off by one could not leave both of them where they are.
    voices = {v["token"]: v for v in client.get("/voices?language=en").json()["voices"]}
    assert voices["9"] == {"token": "9", "label": "Sarah", "gender": "female"}
    assert voices["11"] == {"token": "11", "label": "Adam", "gender": "male"}
    # Ids 20+ are other languages, and only the US English lexicon is loaded.
    assert set(voices) == {str(i) for i in range(20)}


def test_vietnamese_catalog_comes_from_the_package(client):
    # Generated from the manifest the runtime itself resolves `voice=` against, so
    # a package that ships more presets offers more voices without a code change.
    # The fallback pair alone would pass every other test in this file.
    from engines.vieneu_vi import _package_catalog

    published = _package_catalog()
    voices = client.get("/voices?language=vi").json()["voices"]
    assert [v["token"] for v in voices] == [
        e.token for e in sorted(published, key=lambda e: e.token not in VieNeuVi.VOICES.values())
    ]
    # The two spoken by default lead the list.
    assert {v["token"] for v in voices[:2]} == set(VieNeuVi.VOICES.values())


@pytest.mark.parametrize("language", ["en", "vi"])
def test_every_catalog_voice_synthesizes(client, language):
    # The check an inferred list needs: a token that does not resolve reaches
    # `_infer`, where one engine raises on int() and the other hands a stranger to
    # the package. Listing a voice nobody can be spoken with is the failure mode.
    for entry in client.get(f"/voices?language={language}").json()["voices"]:
        res = client.post(
            "/synthesize",
            json={"text": "Hello.", "language": language, "voice": entry["token"]},
        )
        assert res.status_code == 200, entry
        assert is_wav(res.content), entry


@pytest.mark.parametrize("language", ["en", "vi"])
@pytest.mark.parametrize("voice", ["af_sarah", "../etc/passwd", "9999", ""])
def test_unknown_voice_falls_back_instead_of_failing(client, language, voice):
    # The failure this exists to prevent, and it is not hypothetical: a voice name
    # meant for one backend once reached another, was interpolated into a request
    # path, and every turn in one language returned 503.
    #
    # An unrecognised token must never reach the engine's inference call — the
    # English one coerces it with int() and raises, the Vietnamese one hands an
    # arbitrary string to a package with no idea what to do with it. A stale
    # choice costs the caller their VOICE, never their audio.
    res = client.post(
        "/synthesize", json={"text": "Hello.", "language": language, "voice": voice}
    )
    assert res.status_code == 200
    assert is_wav(res.content)


def test_no_voice_and_known_gender_is_unchanged(client):
    # The path the catalog work could most easily have broken while every test
    # about the NEW feature still passed: callers who never ask for a voice.
    for language in ("en", "vi"):
        for gender in ("female", "male"):
            res = client.post(
                "/synthesize",
                json={"text": "Hello.", "language": language, "gender": gender},
            )
            assert res.status_code == 200, (language, gender)
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
