"""Integration tests for `POST /synthesize/stream`, on the real models.

Run against a real uvicorn server rather than TestClient: what these tests are
about — a client that disconnects mid-body, or stops reading — only exists on a
real socket. Same skip switch as `test_app.py`.
"""
import os
import socket
import struct
import threading
import time

import httpx
import pytest
import uvicorn

from app import app

pytestmark = pytest.mark.skipif(
    os.environ.get("LOCAL_TTS_SKIP_MODEL_TESTS") == "1",
    reason="model tests skipped via LOCAL_TTS_SKIP_MODEL_TESTS",
)

VI_TEXT = "Xin chào, hôm nay trời đẹp quá. Bạn có muốn đi dạo công viên không?"
EN_TEXT = "Hello, how much does this cost? I would like two of them."
#: Long enough that a stream is still producing when the test acts on it.
VI_LONG = " ".join([VI_TEXT] * 4)


@pytest.fixture(scope="module")
def base_url():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        try:
            if httpx.get(f"{url}/healthz").status_code == 200:
                break
        except httpx.TransportError:
            pass
        time.sleep(0.5)
    else:
        pytest.fail("sidecar did not become ready")
    yield url
    server.should_exit = True
    thread.join(timeout=10)


def wav_seconds(body: bytes) -> float:
    """Duration of a PCM16 mono WAV body, from its header."""
    sample_rate = struct.unpack_from("<I", body, 24)[0]
    data_bytes = len(body) - 44
    return data_bytes / 2 / sample_rate


def stream_seconds(res: httpx.Response, body: bytes) -> float:
    return len(body) / 2 / int(res.headers["x-sample-rate"])


def post_stream(base_url: str, **payload) -> tuple[httpx.Response, bytes]:
    res = httpx.post(f"{base_url}/synthesize/stream", json=payload, timeout=60)
    return res, res.content


def hold_open(res: httpx.Response):
    """Read one chunk and keep the body open.

    The iterator is returned so the caller keeps it alive. `next(res.iter_raw())`
    on its own drops the generator at once, and httpx closes the response when
    it is collected — which is a disconnect, not a client that is still there.
    """
    chunks = res.iter_raw()
    next(chunks)
    return chunks


def first_byte_after(base_url: str, payload: dict) -> float:
    """Seconds until the first body byte of a fresh stream."""
    start = time.monotonic()
    with httpx.stream("POST", f"{base_url}/synthesize/stream", json=payload, timeout=60) as res:
        assert res.status_code == 200
        for _ in res.iter_raw():
            return time.monotonic() - start
    raise AssertionError("stream produced no bytes")


@pytest.mark.parametrize("language", ["vi", "en"])
def test_stream_announces_its_format(base_url, language):
    res, body = post_stream(base_url, text=VI_TEXT if language == "vi" else EN_TEXT, language=language)
    assert res.status_code == 200
    assert res.headers["x-audio-encoding"] == "pcm16"
    assert int(res.headers["x-sample-rate"]) == (48000 if language == "vi" else 24000)
    assert len(body) > 0 and len(body) % 2 == 0


def test_vietnamese_stream_matches_whole_synthesis_duration(base_url):
    res, body = post_stream(base_url, text=VI_TEXT, language="vi")
    whole = httpx.post(f"{base_url}/synthesize", json={"text": VI_TEXT, "language": "vi"}, timeout=60)
    assert stream_seconds(res, body) == pytest.approx(wav_seconds(whole.content), rel=0.05)


def test_english_stream_matches_per_clause_synthesis_duration(base_url):
    # Kokoro streams clause by clause, so the reference is the same clauses
    # synthesized one at a time — whole-text synthesis differs in prosody.
    from engines.clause_splitter import split_into_clauses

    res, body = post_stream(base_url, text=EN_TEXT, language="en")
    reference = sum(
        wav_seconds(
            httpx.post(f"{base_url}/synthesize", json={"text": clause, "language": "en"}, timeout=60).content
        )
        for clause in split_into_clauses(EN_TEXT)
    )
    assert stream_seconds(res, body) == pytest.approx(reference, rel=0.05)


def test_two_sentence_english_turn_is_not_truncated(base_url):
    # Guards the sherpa-onnx callback trap: a stop-on-0 callback cut a
    # two-sentence turn to its first sentence.
    res, body = post_stream(base_url, text="I am fine. What about you?", language="en")
    assert stream_seconds(res, body) > 1.5


def test_empty_text_fails_before_any_audio(base_url):
    res, body = post_stream(base_url, text="   ", language="vi")
    assert res.status_code == 400
    assert "x-sample-rate" not in res.headers


def test_unsupported_language_400(base_url):
    res, _ = post_stream(base_url, text="hola", language="es")
    assert res.status_code == 400


def test_text_over_the_cap_422(base_url):
    res, _ = post_stream(base_url, text="a" * 2001, language="vi")
    assert res.status_code == 422


@pytest.mark.parametrize("language", ["vi", "en"])
def test_unknown_voice_falls_back(base_url, language):
    res, body = post_stream(base_url, text=VI_TEXT if language == "vi" else EN_TEXT, language=language, voice="no-such-voice")
    assert res.status_code == 200 and len(body) > 0


def test_seeded_streams_are_equivalent(base_url):
    # Chunk boundaries follow wall-clock time, so equality is not asserted;
    # the seed pins the acoustic tokens, which fixes the length closely.
    _, first = post_stream(base_url, text=VI_TEXT, language="vi")
    _, second = post_stream(base_url, text=VI_TEXT, language="vi")
    assert len(second) == pytest.approx(len(first), rel=0.01)


def test_disconnect_mid_stream_releases_the_engine(base_url):
    with httpx.stream("POST", f"{base_url}/synthesize/stream", json={"text": VI_LONG, "language": "vi"}, timeout=60) as res:
        hold_open(res)
    # The closed stream stops at its next chunk boundary; a fresh request gets
    # audio about as fast as an idle engine would give it.
    assert first_byte_after(base_url, {"text": VI_TEXT, "language": "vi"}) < 1.5


def test_disconnect_while_queued_does_not_synthesize_for_nobody(base_url):
    holder = httpx.stream("POST", f"{base_url}/synthesize/stream", json={"text": VI_LONG, "language": "vi"}, timeout=60)
    res = holder.__enter__()
    try:
        chunks = hold_open(res)
        # Queued behind the holder, then abandoned before it gets the engine.
        # httpx's timeout is per read, and waiting for the status line is a read.
        started = time.monotonic()
        with pytest.raises(httpx.ReadTimeout):
            httpx.post(f"{base_url}/synthesize/stream", json={"text": VI_TEXT, "language": "vi"}, timeout=1)
        assert time.monotonic() - started < 1.5
        del chunks
    finally:
        holder.__exit__(None, None, None)
    # Neither the holder nor the abandoned waiter should still own the engine.
    assert first_byte_after(base_url, {"text": VI_TEXT, "language": "vi"}) < 1.5


def test_concurrent_streams_queue_instead_of_failing(base_url):
    results = {}

    def run(name):
        start = time.monotonic()
        res, body = post_stream(base_url, text=VI_TEXT, language="vi")
        results[name] = (res.status_code, len(body), time.monotonic() - start)

    threads = [threading.Thread(target=run, args=(n,)) for n in ("a", "b")]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert all(status == 200 and size > 0 for status, size, _ in results.values())
