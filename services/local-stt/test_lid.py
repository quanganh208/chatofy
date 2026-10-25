"""Language identification on `/transcribe`: the `candidates` contract.

Needs the Whisper weights (scripts/download_models.py with LOCAL_STT_LID on).
The real-speech cases also need FLEURS clips that
`benchmarks/lid/scripts/prepare_public.py` fetches; each skips without them.
"""
import os
from pathlib import Path

import numpy as np
import pytest

from engines.base import SttBusyError
from lid.log_mel import N_MELS, RATE, log_mel
from lid.model_decider import WhisperLanguageId, window_samples

LID_DATA = Path(__file__).resolve().parent.parent.parent / "benchmarks/lid/data/public/fleurs"
#: One FLEURS read sentence per language, 4-6 s, each scored above 0.99 for
#: its own language when the arm was measured.
CLIPS = {
    "vi": LID_DATA / "d1fff9ce6c9f1b4f.wav",
    "en": LID_DATA / "1dd2a19259b9bdbc.wav",
    "zh": LID_DATA / "feb9713c4c48ca4c.wav",
}

needs_models = pytest.mark.skipif(
    os.environ.get("LOCAL_STT_SKIP_MODEL_TESTS") == "1",
    reason="model tests skipped via LOCAL_STT_SKIP_MODEL_TESTS",
)
needs_lid = pytest.mark.skipif(
    not WhisperLanguageId.weights_present(), reason="Whisper LID weights missing; run scripts/download_models.py"
)


def _clip(lang: str) -> bytes:
    path = CLIPS[lang]
    if not path.exists():
        pytest.skip(f"{path.name} missing")
    return path.read_bytes()


def _post(client, audio: bytes, language: str, candidates=(), **data):
    return client.post(
        "/transcribe",
        files={"file": ("clip.wav", audio, "audio/wav")},
        data={"language": language, "candidates": list(candidates), **data},
    )


# ── Pure parts: no weights ──────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("seconds", "window_s"), [(0.4, 5), (5.0, 5), (5.01, 6), (7.2, 8), (29.5, 30), (41.0, 30)]
)
def test_the_window_is_the_turn_in_whole_seconds_between_5_and_30(seconds, window_s):
    assert window_samples(int(seconds * RATE)) == window_s * RATE


def test_log_mel_has_one_frame_per_hop_of_the_window():
    samples = np.random.default_rng(0).standard_normal(3 * RATE).astype(np.float32) * 0.1
    mel = log_mel(samples, 5 * RATE)
    assert mel.shape == (1, N_MELS, 500)
    assert mel.dtype == np.float32
    # Whisper's floor: nothing more than 8 decades (2.0 after scaling) below the peak.
    assert mel.max() - mel.min() <= 2.0 + 1e-6


# ── Through the app ──────────────────────────────────────────────────────────


@needs_models
@pytest.mark.parametrize("language", ["vi", "en", "zh"])
def test_without_candidates_the_response_is_unchanged(client, webm_audio, language):
    body = client.post(
        "/transcribe",
        files={"file": ("audio.webm", webm_audio, "audio/webm")},
        data={"language": language},
    ).json()
    assert body["language"] == language
    assert "languageConfidence" not in body


@needs_models
@needs_lid
def test_healthz_lists_what_candidates_may_name(client):
    assert client.get("/healthz").json()["lidLanguages"] == ["vi", "en", "zh"]


@needs_models
@pytest.mark.parametrize(
    "candidates",
    [["vi"], ["vi", "vi"], ["en", "zh"], ["vi", "fr"]],
    ids=["one", "duplicate", "without-language", "unsupported"],
)
def test_a_malformed_candidate_list_is_a_400(client, webm_audio, candidates):
    res = _post(client, webm_audio, "vi", candidates)
    assert res.status_code == 400


@needs_models
def test_candidates_without_an_identifier_are_a_409(client, webm_audio, monkeypatch):
    from app import registry

    monkeypatch.setattr(registry, "_lid", None)
    res = _post(client, webm_audio, "vi", ["vi", "en"])
    assert res.status_code == 409
    assert client.get("/healthz").json()["lidLanguages"] == []


@needs_models
@needs_lid
def test_candidates_with_identification_off_are_a_409(client, webm_audio, monkeypatch):
    monkeypatch.setenv("LOCAL_STT_LID", "off")
    assert _post(client, webm_audio, "vi", ["vi", "en"]).status_code == 409


@needs_models
@needs_lid
@pytest.mark.parametrize("spoken", ["vi", "en", "zh"])
def test_each_language_is_identified_among_all_three(client, spoken):
    declared = "en" if spoken == "vi" else "vi"
    body = _post(client, _clip(spoken), declared, ["vi", "en", "zh"]).json()
    assert body["language"] == spoken
    assert 0.9 < body["languageConfidence"] <= 1.0
    assert body["text"]
    assert 3000 <= body["lidSpeechMs"] <= 6500


@needs_models
@needs_lid
def test_a_pair_answers_one_of_its_two(client):
    # zh audio, asked only vi or en: whichever it picks, it is a candidate.
    body = _post(client, _clip("zh"), "vi", ["vi", "en"]).json()
    assert body["language"] in {"vi", "en"}
    assert 0.5 <= body["languageConfidence"] <= 1.0


@needs_models
@needs_lid
def test_hotwords_do_not_move_the_decision(client):
    plain = _post(client, _clip("en"), "vi", ["vi", "en"]).json()
    biased = _post(client, _clip("en"), "vi", ["vi", "en"], hotwords=["Phở", "Hà Nội", "Việt Nam"]).json()
    assert biased["language"] == plain["language"] == "en"
    assert biased["languageConfidence"] == pytest.approx(plain["languageConfidence"])


@needs_models
@needs_lid
def test_the_vi_alternate_is_dropped_when_the_turn_is_not_vi(client):
    from app import registry

    if registry.alternate("vi") is None:
        pytest.skip("vi alternate not seeded")
    body = _post(client, _clip("en"), "vi", ["vi", "en"], alternates="true").json()
    assert body["language"] == "en"
    assert "alternates" not in body


@needs_models
@needs_lid
def test_a_busy_identifier_decodes_the_declared_language_unsure(client, monkeypatch):
    from app import registry

    def busy(*_args, **_kwargs):
        raise SttBusyError("saturated")

    monkeypatch.setattr(registry.lid, "probabilities", busy)
    res = _post(client, _clip("en"), "vi", ["vi", "en"])
    assert res.status_code == 200
    assert res.json()["language"] == "vi"
    assert res.json()["languageConfidence"] is None


@needs_models
@needs_lid
def test_a_busy_identified_engine_falls_back_to_the_declared_one(client, monkeypatch):
    from app import registry

    def busy(*_args, **_kwargs):
        raise SttBusyError("saturated")

    monkeypatch.setattr(registry.get("en"), "transcribe", busy)
    res = _post(client, _clip("en"), "vi", ["vi", "en"])
    assert res.status_code == 200
    assert res.json()["language"] == "vi"
    assert res.json()["languageConfidence"] is None

    # Only when the declared engine is full as well is the turn refused.
    monkeypatch.setattr(registry.get("vi"), "transcribe_with_pauses", busy)
    assert _post(client, _clip("en"), "vi", ["vi", "en"]).status_code == 503
