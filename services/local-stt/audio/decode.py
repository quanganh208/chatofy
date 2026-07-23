"""Audio decoding — any browser/upload container to the array the models want.

The web app records `audio/webm;codecs=opus` and also accepts uploaded mp3/m4a/
wav/flac/ogg. sherpa-onnx wants mono float32 at 16 kHz. PyAV bundles its own
ffmpeg libraries, so this works with no ffmpeg binary on PATH.

Resampling is explicit: microphone capture is 48 kHz while both ASR models are
trained at 16 kHz, and feeding the wrong rate produces plausible-but-wrong
transcripts instead of an error.
"""
import io

import av
import numpy as np
from av.audio.resampler import AudioResampler

#: Sample rate both Zipformer-vi and Moonshine-en are trained at.
TARGET_RATE = 16000


class DecodeError(Exception):
    """Raised when the payload is not decodable audio. Maps to HTTP 400."""


def _as_frames(resampled) -> list:
    """Normalize AudioResampler.resample() across PyAV versions.

    PyAV >= 9 returns a list of frames; older releases return a single frame or
    None. Verified as a list on the pinned PyAV 18.
    """
    if resampled is None:
        return []
    if isinstance(resampled, list):
        return resampled
    return [resampled]


def decode_to_16k_mono(data: bytes) -> np.ndarray:
    """Decode any supported container to mono float32 @ 16 kHz.

    Raises DecodeError when the payload is empty, holds no audio stream, or
    cannot be decoded.
    """
    if not data:
        raise DecodeError("empty audio payload")

    chunks: list[np.ndarray] = []
    try:
        with av.open(io.BytesIO(data)) as container:
            stream = next((s for s in container.streams if s.type == "audio"), None)
            if stream is None:
                raise DecodeError("no audio stream in the payload")

            resampler = AudioResampler(format="fltp", layout="mono", rate=TARGET_RATE)
            for frame in container.decode(stream):
                for out in _as_frames(resampler.resample(frame)):
                    chunks.append(out.to_ndarray().reshape(-1))
            # Flush whatever the resampler is still buffering.
            for out in _as_frames(resampler.resample(None)):
                chunks.append(out.to_ndarray().reshape(-1))
    except DecodeError:
        raise
    except Exception as err:  # av raises a family of codec/container errors
        raise DecodeError(f"could not decode audio: {err}") from err

    if not chunks:
        raise DecodeError("audio decoded to zero samples")

    return np.concatenate(chunks).astype(np.float32)
