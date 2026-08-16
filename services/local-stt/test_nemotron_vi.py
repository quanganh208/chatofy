"""Tests for the Vietnamese streaming engine and the choice between engines.

Split from test_app.py because most of these need no weights at all: the
language-tag filter and the engine selection are pure, and they guard the two
mistakes that would be invisible at runtime — a tag read aloud into a call, and
a rollback switch that silently does nothing.
"""
import os

import numpy as np
import pytest

from engines.nemotron_vi import NemotronVi
from engines.registry import UnknownEngineError, _vi_engine_type, _vi_names
from engines.zipformer_vi import ZipformerVi

def _runtime_available() -> bool:
    """Whether the library is actually there, wherever it is.

    Asked of the filesystem rather than of an environment variable. Keying the
    skip off `LOCAL_STT_PARAKEET_LIB` meant that on a machine where everything
    worked — the library sitting in its default place, needing no variable — the
    three tests that exercise it skipped themselves and the suite still read
    green.
    """
    from engines.parakeet_runtime import ParakeetError, _library_path

    try:
        return _library_path().exists()
    except ParakeetError:
        return False


REQUIRES_WEIGHTS = pytest.mark.skipif(
    not _runtime_available() or os.environ.get("LOCAL_STT_SKIP_MODEL_TESTS") == "1",
    reason="needs libparakeet and the GGUF weights",
)

FIXTURE = "../../benchmarks/realtime/fixtures/vlsp-vi-01.wav"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("xin chào <vi-VN> hôm nay", "xin chào hôm nay"),
        # Truncated tag: the model spells tags out of ordinary pieces once the
        # single-token form is barred, so the closing bracket may be missing.
        ("Câu xong. <sl-SI", "Câu xong."),
        ("< en-US >giữa câu", "giữa câu"),
        ("không có thẻ nào", "không có thẻ nào"),
        # Punctuation and casing survive: unlike Zipformer this model emits them,
        # and the clause splitter downstream reads them.
        ("Chào bạn, hôm nay thế nào?", "Chào bạn, hôm nay thế nào?"),
    ],
)
def test_postprocess_strips_language_tags(raw, expected):
    assert NemotronVi().postprocess(raw) == expected


def test_postprocess_leaves_no_angle_bracket_for_tts():
    """The whole point of the filter: nothing tag-shaped reaches the speaker."""
    assert "<" not in NemotronVi().postprocess("một hai <vi-VN> ba <en-US> bốn")


def test_vi_engine_defaults_to_streaming(monkeypatch):
    monkeypatch.delenv("LOCAL_STT_VI_ENGINE", raising=False)
    assert _vi_engine_type() is NemotronVi


def test_vi_engine_rollback_is_one_value(monkeypatch):
    monkeypatch.setenv("LOCAL_STT_VI_ENGINE", "zipformer")
    assert _vi_engine_type() is ZipformerVi


def test_unknown_vi_engine_fails_loudly_at_startup(monkeypatch):
    monkeypatch.setenv("LOCAL_STT_VI_ENGINE", "typo")
    with pytest.raises(UnknownEngineError):
        _vi_engine_type()


def test_vietnamese_loads_both_roles(monkeypatch):
    """The split the measurement asked for: the streaming engine speaks, the
    accurate one is what anybody reads."""
    monkeypatch.delenv("LOCAL_STT_VI_ENGINE", raising=False)
    assert _vi_names() == ("nemotron", "zipformer")


def test_rollback_loads_only_what_it_will_use(monkeypatch):
    """With the streaming path off there is no second role, and a 1GB model
    nothing calls is a cost with no buyer."""
    monkeypatch.setenv("LOCAL_STT_VI_ENGINE", "zipformer")
    assert _vi_names() == ("zipformer",)


def test_streaming_support_is_declared_not_guessed():
    # The HTTP layer refuses a session on this rather than discovering mid-turn
    # that the engine re-decodes.
    assert NemotronVi.supports_streaming is True
    assert ZipformerVi.supports_streaming is False


@pytest.fixture(scope="module")
def loaded_engine():
    engine = NemotronVi()
    engine.load()
    return engine


@pytest.fixture(scope="module")
def fixture_samples():
    from audio.decode import decode_to_16k_mono

    with open(FIXTURE, "rb") as handle:
        return decode_to_16k_mono(handle.read())


@REQUIRES_WEIGHTS
def test_streaming_only_ever_appends(loaded_engine, fixture_samples):
    """The property the whole commit design rests on.

    Not "a longer read agrees with a shorter one" — stronger: the running
    transcript is append-only across every feed, so a word handed to TTS can
    never be contradicted later.
    """
    step = 16000 * 3 // 10  # 300ms, the cadence the commit path feeds at
    running = ""
    snapshots = []
    with loaded_engine.stream() as stream:
        for start in range(0, len(fixture_samples), step):
            new_text, _events = stream.feed(fixture_samples[start : start + step])
            running += new_text
            snapshots.append(running)
        running += stream.finalize()

    violations = [
        i for i in range(1, len(snapshots)) if not snapshots[i].startswith(snapshots[i - 1])
    ]
    assert violations == []
    assert len(running.split()) > 100


@REQUIRES_WEIGHTS
def test_decoder_does_not_go_silent_across_an_acoustic_seam(
    loaded_engine, fixture_samples
):
    """Regression guard for the failure that blocked this whole approach.

    This fixture is glued from separate clips, so it carries a hard acoustic
    discontinuity ~28s in. The decoder used to emit a language-tag token there
    and then produce nothing for the rest of the audio — 101 words instead of
    144, with the tail simply missing. Word count is the cheapest way to catch a
    regression to that.
    """
    text = loaded_engine.transcribe(fixture_samples)
    assert len(text.split()) > 130, "decoder stopped early at the seam"


@REQUIRES_WEIGHTS
def test_transcribe_accepts_plain_float_arrays(loaded_engine):
    """Silence is a valid input and must not raise; it just has no words."""
    assert loaded_engine.transcribe(np.zeros(16000, dtype=np.float32)) == ""
