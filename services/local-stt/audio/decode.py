"""Audio decoding — any browser/upload container to the array the models want.

The web app records `audio/webm;codecs=opus` and also accepts uploaded mp3/m4a/
wav/flac/ogg. sherpa-onnx wants mono float32 at 16 kHz. PyAV bundles its own
ffmpeg libraries, so this works with no ffmpeg binary on PATH.

Resampling is explicit: microphone capture is 48 kHz while both ASR models are
trained at 16 kHz, and feeding the wrong rate produces plausible-but-wrong
transcripts instead of an error.
"""
import io
import os

import av
import numpy as np
from av.audio.resampler import AudioResampler

#: Sample rate both Zipformer-vi and Moonshine-en are trained at.
TARGET_RATE = 16000

#: Longest utterance we will decode. A translation turn is one utterance, but a
#: caller can upload an arbitrary file, and a few MB of Opus is close to an hour
#: of audio — which would be held in memory several times over and would hold
#: the engine lock for the whole offline decode. Bound it and reject the rest.
MAX_AUDIO_SECONDS = float(os.environ.get("LOCAL_STT_MAX_AUDIO_SECONDS", "300"))
_MAX_SAMPLES = int(TARGET_RATE * MAX_AUDIO_SECONDS)


class DecodeError(Exception):
    """Raised when the payload is not decodable audio. Maps to HTTP 400."""


class AudioTooLongError(DecodeError):
    """Raised when the audio exceeds MAX_AUDIO_SECONDS. Maps to HTTP 413."""


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
    total = 0
    try:
        with av.open(io.BytesIO(data)) as container:
            stream = next((s for s in container.streams if s.type == "audio"), None)
            if stream is None:
                raise DecodeError("no audio stream in the payload")

            resampler = AudioResampler(format="fltp", layout="mono", rate=TARGET_RATE)
            for frame in container.decode(stream):
                for out in _as_frames(resampler.resample(frame)):
                    samples = out.to_ndarray().reshape(-1)
                    total += samples.size
                    # Bail during decoding, not after: the point is to avoid
                    # materialising an hour of audio in the first place.
                    if total > _MAX_SAMPLES:
                        raise AudioTooLongError(
                            f"audio exceeds the {MAX_AUDIO_SECONDS:.0f}s limit"
                        )
                    chunks.append(samples)
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


def pcm16_to_float32(data: bytes) -> np.ndarray:
    """Raw PCM16 little-endian mono at TARGET_RATE, as the models want it.

    The streaming path sends this instead of a container. It is what the client
    already captures, so wrapping each 300ms chunk in a WAV header only to strip
    it again here would be work at both ends for a format neither side wants.

    No length ceiling: a chunk is bounded by the cadence that produced it, and
    the session it feeds is bounded by its own TTL rather than by any one chunk.
    """
    if len(data) % 2:
        raise DecodeError("PCM16 payload has a trailing odd byte")
    # `astype` copies, which is what the binding needs: `frombuffer` returns a
    # read-only view over the request body, and the C API is handed a raw pointer
    # to write-capable, correctly aligned float32.
    samples = np.frombuffer(data, dtype="<i2").astype(np.float32)
    return samples / 32768.0
