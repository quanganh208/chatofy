"""Unit tests for the audio decode path. No model weights required."""
import numpy as np
import pytest

from audio.decode import TARGET_RATE, DecodeError, decode_to_16k_mono


def test_decodes_webm_opus_to_mono_16k(webm_audio):
    samples = decode_to_16k_mono(webm_audio)

    assert samples.ndim == 1, "engines expect a flat mono array"
    assert samples.dtype == np.float32
    # 1s of source audio, resampled 48k -> 16k. Allow 100ms of codec padding.
    assert abs(len(samples) - TARGET_RATE) < TARGET_RATE * 0.1


def test_decoded_signal_is_not_silence(webm_audio):
    # Guards against a resampler misconfiguration that returns the right shape
    # full of zeros — which would silently produce empty transcripts.
    samples = decode_to_16k_mono(webm_audio)
    assert float(np.abs(samples).max()) > 0.1


def test_empty_payload_raises(webm_audio):
    with pytest.raises(DecodeError):
        decode_to_16k_mono(b"")


def test_garbage_payload_raises():
    with pytest.raises(DecodeError):
        decode_to_16k_mono(b"this is not audio" * 100)
