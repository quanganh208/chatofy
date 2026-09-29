"""Tests for the pinned Silero speech gate.

Model-gated like `test_app.py` and `test_embed.py`: set
LOCAL_STT_SKIP_MODEL_TESTS=1 to skip on a machine without the weights cached.
The real-speech assertion additionally skips on its own if the parakeet
tarball's `test_wavs/0.wav` specifically is missing, since that clip is a
by-product of `fetch_parakeet_en` rather than something this module fetches.
"""
import os

import numpy as np
import pytest

from audio.decode import decode_to_16k_mono
from audio.silero_speech import ModelHashMismatchError, SileroSpeechGate
from conftest import make_webm_opus
from engines.base import MODELS_DIR, SttBusyError

pytestmark = pytest.mark.skipif(
    os.environ.get("LOCAL_STT_SKIP_MODEL_TESTS") == "1",
    reason="model tests skipped via LOCAL_STT_SKIP_MODEL_TESTS",
)

SPEECH_CLIP = MODELS_DIR / "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8" / "test_wavs" / "0.wav"


@pytest.fixture(scope="module")
def gate():
    g = SileroSpeechGate()
    g.load()
    yield g
    g.unload()


def test_digital_silence_holds_no_speech(gate):
    assert gate.speech_ms(np.zeros(16000, dtype=np.float32)) == 0


def test_the_fixture_sweep_is_not_speech(gate):
    # A tone, not a voice — the reason this gate is a learned detector and not
    # another energy threshold like `speech_duration.py`'s.
    samples = decode_to_16k_mono(make_webm_opus(2.0))
    assert gate.speech_ms(samples) < 300


@pytest.mark.skipif(
    not SPEECH_CLIP.exists(),
    reason=f"{SPEECH_CLIP} is missing; run scripts/download_models.py",
)
def test_a_public_speech_clip_clears_the_floor(gate):
    with open(SPEECH_CLIP, "rb") as f:
        samples = decode_to_16k_mono(f.read())
    assert gate.speech_ms(samples) >= 300


def test_a_file_with_the_wrong_hash_is_refused(tmp_path):
    bogus = tmp_path / "silero_vad.onnx"
    bogus.write_bytes(b"not a silero model")
    gate = SileroSpeechGate(model_path=bogus)
    with pytest.raises(ModelHashMismatchError):
        gate.load()


def test_the_extra_caller_past_the_pool_gets_busy(monkeypatch):
    """More concurrent callers than the pool holds: the extra one refuses.

    Same property `test_lane_wait_times_out_instead_of_queueing` pins for an
    engine — a saturated gate should not queue invisibly either.
    """
    monkeypatch.setenv("LOCAL_STT_CONCURRENCY", "1")
    monkeypatch.setenv("LOCAL_STT_LANE_WAIT_MS", "50")
    gate = SileroSpeechGate()
    gate.load()
    try:
        detector = gate._pool.get()  # hold the only detector in the pool
        with pytest.raises(SttBusyError):
            gate.speech_ms(np.zeros(1600, dtype=np.float32))
    finally:
        gate._pool.put(detector)
        gate.unload()
