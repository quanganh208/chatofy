"""Shared test fixtures.

Builds real webm/opus payloads in memory — the exact container MediaRecorder
produces in Chrome/Firefox — so the decode path is exercised for real rather
than mocked.
"""
import io
import math

import av
import numpy as np
import pytest

SRC_RATE = 48000  # what a browser mic capture actually delivers
OPUS_FRAME = 960  # 20ms @ 48 kHz; Opus requires fixed frame sizes


def make_webm_opus(duration_s: float = 1.0) -> bytes:
    """Encode a stereo 48 kHz sweep into a webm/opus container in memory."""
    buf = io.BytesIO()
    container = av.open(buf, mode="w", format="webm")
    stream = container.add_stream("libopus", rate=SRC_RATE)
    stream.layout = "stereo"

    n = int(SRC_RATE * duration_s)
    t = np.arange(n, dtype=np.float32) / SRC_RATE
    # 0.5 amplitude: real mic input is not full-scale, and Opus overshoots past
    # 1.0 on full-scale sines.
    sweep = (0.5 * np.sin(2 * math.pi * (220 + 330 * t) * t)).astype(np.float32)
    samples = np.stack([sweep, sweep])

    pts = 0
    for start in range(0, n - OPUS_FRAME + 1, OPUS_FRAME):
        chunk = np.ascontiguousarray(samples[:, start : start + OPUS_FRAME])
        frame = av.AudioFrame.from_ndarray(chunk, format="fltp", layout="stereo")
        frame.rate = SRC_RATE
        frame.pts = pts
        pts += OPUS_FRAME
        for packet in stream.encode(frame):
            container.mux(packet)
    for packet in stream.encode(None):
        container.mux(packet)
    container.close()
    return buf.getvalue()


@pytest.fixture(scope="session")
def webm_audio() -> bytes:
    return make_webm_opus()
