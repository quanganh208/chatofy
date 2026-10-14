"""Integration tests for the local STT sidecar.

These load the real ONNX models (needs scripts/download_models.py to have run),
so they are integration-level, not unit. Set LOCAL_STT_SKIP_MODEL_TESTS=1 to
skip on machines without the weights cached.

Transcript *content* is not asserted here: the fixture is a synthetic sweep, not
speech, so an empty transcript is a correct result. Real-speech accuracy is
covered by the benchmark harness and by manual verification.
"""
import os

import pytest
from fastapi.testclient import TestClient

from app import app
from conftest import make_webm_opus

pytestmark = pytest.mark.skipif(
    os.environ.get("LOCAL_STT_SKIP_MODEL_TESTS") == "1",
    reason="model tests skipped via LOCAL_STT_SKIP_MODEL_TESTS",
)


def test_healthz_ok(client):
    res = client.get("/healthz")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_healthz_reports_supported_languages(client):
    from engines.registry import SUPPORTED_LANGUAGES

    res = client.get("/healthz")
    assert res.json()["languages"] == list(SUPPORTED_LANGUAGES)


def test_healthz_lists_vi_en_and_zh(client):
    assert set(client.get("/healthz").json()["languages"]) == {"vi", "en", "zh"}


@pytest.mark.parametrize("language", ["vi", "en", "zh"])
def test_transcribe_returns_text_field(client, webm_audio, language):
    res = client.post(
        "/transcribe",
        files={"file": ("audio.webm", webm_audio, "audio/webm")},
        data={"language": language},
    )
    assert res.status_code == 200
    body = res.json()
    assert isinstance(body["text"], str)
    assert body["language"] == language


def test_hotwords_reach_the_vietnamese_engine(client, webm_audio, monkeypatch):
    from app import registry

    engine = registry.get("vi")
    seen = {}

    def capture(samples, hotwords=""):
        seen["hotwords"] = hotwords
        return "ok"

    # Vietnamese goes through the pause-measuring decode.
    monkeypatch.setattr(
        engine, "transcribe_with_pauses", lambda s, h="": (capture(s, h), None)
    )
    res = client.post(
        "/transcribe",
        files={"file": ("audio.webm", webm_audio, "audio/webm")},
        data={"language": "vi", "hotwords": ["poker", "Target"]},
    )

    assert res.status_code == 200
    # Upper-cased to match the token table, in the order the caller named them,
    # and nothing added: there is no standing list.
    assert seen["hotwords"] == "POKER/TARGET"


def test_a_turn_naming_no_term_decodes_unbiased(client, webm_audio, monkeypatch):
    from app import registry

    engine = registry.get("vi")
    seen = {}

    def capture(samples, hotwords=""):
        seen["hotwords"] = hotwords
        return "ok"

    # Vietnamese goes through the pause-measuring decode.
    monkeypatch.setattr(
        engine, "transcribe_with_pauses", lambda s, h="": (capture(s, h), None)
    )
    client.post(
        "/transcribe",
        files={"file": ("audio.webm", webm_audio, "audio/webm")},
        data={"language": "vi"},
    )

    # Empty is what keeps an ordinary turn on the decoder every published number
    # for this model was measured with.
    assert seen["hotwords"] == ""
    assert engine.recognizer_for("") is not engine.recognizer_for("POKER")


def test_an_engine_that_cannot_bias_is_handed_nothing(
    client, webm_audio, monkeypatch
):
    from app import registry

    engine = registry.get("en")
    assert not engine.supports_hotwords
    seen = {}

    def capture(samples, hotwords=""):
        seen["hotwords"] = hotwords
        return "ok"

    monkeypatch.setattr(engine, "transcribe", capture)
    client.post(
        "/transcribe",
        files={"file": ("audio.webm", webm_audio, "audio/webm")},
        data={"language": "en", "hotwords": ["poker"]},
    )

    # Not "passed and ignored": sherpa-onnx accepts the argument on every
    # recognizer type, so a silent no-op is what would go unnoticed.
    assert seen["hotwords"] == ""


# ── Speech gate ──────────────────────────────────────────────────────────────
# `min_speech_ms` is opt-in per request: absent, the engine runs exactly as it
# always did; set, speech is measured first and a clip under the floor never
# reaches the engine at all.


def test_min_speech_ms_absent_skips_the_gate(client, webm_audio, monkeypatch):
    from app import registry, speech_gate

    engine = registry.get("vi")
    gate_called = {"count": 0}
    engine_called = {"count": 0}

    original_speech_ms = speech_gate.speech_ms

    def spy_speech_ms(samples):
        gate_called["count"] += 1
        return original_speech_ms(samples)

    def capture(samples, hotwords=""):
        engine_called["count"] += 1
        return "ok"

    monkeypatch.setattr(speech_gate, "speech_ms", spy_speech_ms)
    # Vietnamese goes through the pause-measuring decode.
    monkeypatch.setattr(
        engine, "transcribe_with_pauses", lambda s, h="": (capture(s, h), None)
    )

    res = client.post(
        "/transcribe",
        files={"file": ("audio.webm", webm_audio, "audio/webm")},
        data={"language": "vi"},
    )

    assert res.status_code == 200
    assert gate_called["count"] == 0
    assert engine_called["count"] == 1
    assert "speechMs" not in res.json()


def test_min_speech_ms_gates_a_non_speech_clip(client, webm_audio, monkeypatch):
    # The fixture is a synthetic sweep, not speech — Silero scores it well
    # under the floor (see test_silero_speech.py), which is what this test
    # needs: a clip the gate refuses without ever reaching the engine.
    from app import registry

    engine = registry.get("vi")
    engine_called = {"count": 0}

    def capture(samples, hotwords=""):
        engine_called["count"] += 1
        return "should not be reached"

    # Vietnamese goes through the pause-measuring decode.
    monkeypatch.setattr(
        engine, "transcribe_with_pauses", lambda s, h="": (capture(s, h), None)
    )

    res = client.post(
        "/transcribe",
        files={"file": ("audio.webm", webm_audio, "audio/webm")},
        data={"language": "vi", "min_speech_ms": "300"},
    )

    assert res.status_code == 200
    body = res.json()
    assert body["text"] == ""
    assert engine_called["count"] == 0
    assert isinstance(body["speechMs"], int)
    assert body["speechMs"] < 300


def test_vad_busy_gives_503(client, monkeypatch):
    from app import speech_gate
    from engines.base import SttBusyError

    def busy(samples):
        raise SttBusyError("silero VAD saturated: no detector within 2000ms")

    monkeypatch.setattr(speech_gate, "speech_ms", busy)

    res = client.post(
        "/transcribe",
        files={"file": ("audio.webm", make_webm_opus(1.0), "audio/webm")},
        data={"language": "vi", "min_speech_ms": "300"},
    )

    assert res.status_code == 503


def test_unsupported_language_400(client, webm_audio):
    res = client.post(
        "/transcribe",
        files={"file": ("audio.webm", webm_audio, "audio/webm")},
        data={"language": "fr"},
    )
    assert res.status_code == 400


def test_zh_transcribe_returns_no_pauses(client, webm_audio):
    res = client.post(
        "/transcribe",
        files={"file": ("audio.webm", webm_audio, "audio/webm")},
        data={"language": "zh"},
    )
    assert res.status_code == 200
    assert "pauses" not in res.json()


def test_undecodable_audio_400(client):
    res = client.post(
        "/transcribe",
        files={"file": ("audio.webm", b"not audio at all", "audio/webm")},
        data={"language": "vi"},
    )
    assert res.status_code == 400


def test_missing_language_422(client, webm_audio):
    # FastAPI validation rejects the missing form field before our handler runs.
    res = client.post(
        "/transcribe",
        files={"file": ("audio.webm", webm_audio, "audio/webm")},
    )
    assert res.status_code == 422


# ── Alternate recognizer ─────────────────────────────────────────────────────
# `alternates=true` asks for a second, unbiased reading of the same samples for
# the API to fuse into the display. Off, the response is today's byte for byte;
# on, anything going wrong with the second decode drops the key, never the turn.


class _FakeAlternate:
    """Stands in for the 150M: records what it was handed, answers or raises."""

    def __init__(self, answer="xin chào các bạn", error: Exception | None = None, delay=0.0):
        self.answer = answer
        self.error = error
        self.delay = delay
        self.calls: list[str] = []

    def transcribe(self, samples, hotwords="", *, lane_wait_ms=None, abandoned=None):
        import time

        self.calls.append(hotwords)
        time.sleep(self.delay)
        if self.error is not None:
            raise self.error
        return self.answer


def _post_vi(client, webm_audio, **data):
    return client.post(
        "/transcribe",
        files={"file": ("audio.webm", webm_audio, "audio/webm")},
        data={"language": "vi", **data},
    )


def _stub_primary(monkeypatch, text="xin chào", delay=0.0):
    import time

    from app import registry

    def decode(samples, hotwords=""):
        time.sleep(delay)
        return text, None

    monkeypatch.setattr(registry.get("vi"), "transcribe_with_pauses", decode)


def test_alternates_off_leaves_the_response_unchanged(client, webm_audio, monkeypatch):
    from app import registry

    fake = _FakeAlternate()
    monkeypatch.setattr(registry, "alternate", lambda lang: fake)
    _stub_primary(monkeypatch)

    res = _post_vi(client, webm_audio)

    assert res.status_code == 200
    assert res.json() == {"text": "xin chào", "language": "vi"}
    assert fake.calls == []


def test_alternates_on_returns_the_second_reading(client, webm_audio, monkeypatch):
    from app import registry

    fake = _FakeAlternate("xin chào các bạn")
    monkeypatch.setattr(registry, "alternate", lambda lang: fake)
    _stub_primary(monkeypatch)

    res = _post_vi(client, webm_audio, alternates="true", hotwords=["poker"])

    assert res.status_code == 200
    body = res.json()
    assert body["text"] == "xin chào"
    assert body["alternates"] == ["xin chào các bạn"]
    # Never biased: the primary got the term, the alternate did not.
    assert fake.calls == [""]


def test_alternates_on_without_an_alternate_loaded(client, webm_audio, monkeypatch):
    from app import registry

    monkeypatch.setattr(registry, "alternate", lambda lang: None)
    _stub_primary(monkeypatch)

    res = _post_vi(client, webm_audio, alternates="true")

    assert res.status_code == 200
    assert "alternates" not in res.json()


@pytest.mark.parametrize(
    "error",
    [
        __import__("engines.base", fromlist=["SttBusyError"]).SttBusyError(
            "vi engine saturated: no lane within 2000ms"
        ),
        RuntimeError("onnx went away"),
    ],
)
def test_a_failing_alternate_never_fails_the_turn(client, webm_audio, monkeypatch, error):
    from app import registry

    monkeypatch.setattr(registry, "alternate", lambda lang: _FakeAlternate(error=error))
    _stub_primary(monkeypatch)

    res = _post_vi(client, webm_audio, alternates="true")

    assert res.status_code == 200
    assert res.json() == {"text": "xin chào", "language": "vi"}


def test_a_late_alternate_is_dropped_not_waited_for(client, webm_audio, monkeypatch):
    # The transcript is the turn's critical path: an alternate still decoding
    # past its wait must not hold the response up.
    import time

    import app
    from app import registry

    monkeypatch.setattr(app, "ALTERNATE_WAIT_MS", 50.0)
    monkeypatch.setattr(registry, "alternate", lambda lang: _FakeAlternate(delay=1.0))
    _stub_primary(monkeypatch)

    started = time.perf_counter()
    res = _post_vi(client, webm_audio, alternates="true")

    assert res.status_code == 200
    assert res.json() == {"text": "xin chào", "language": "vi"}
    assert time.perf_counter() - started < 0.9


class _LaneEngine:
    """A real `SttEngine` (real lanes, real abandonment) over a fake recognizer
    that only counts decodes, so the tests can hold its single lane."""

    @staticmethod
    def build(monkeypatch, lane_wait_ms="2000"):
        from engines.base import SttEngine

        monkeypatch.setenv("LOCAL_STT_CONCURRENCY", "1")
        monkeypatch.setenv("LOCAL_STT_LANE_WAIT_MS", lane_wait_ms)
        decodes: list[int] = []

        class _Result:
            text, tokens, timestamps = "xin chào các bạn", [], []

        class _Stream:
            result = _Result()

            def accept_waveform(self, *_):
                pass

        class _Recognizer:
            def create_stream(self, **_):
                return _Stream()

            def decode_stream(self, _stream):
                decodes.append(1)

        class _Engine(SttEngine):
            lang = "vi"

            def load(self) -> None:
                self._recognizer = _Recognizer()

        engine = _Engine()
        engine.load()
        return engine, decodes


def test_an_abandoned_alternate_gives_its_lane_back_without_decoding(
    client, webm_audio, monkeypatch
):
    # The primary fails while the alternate is still waiting for a lane. When
    # that lane frees up — after the response is gone — the alternate must not
    # spend it on a decode nobody will read.
    from concurrent.futures import ThreadPoolExecutor

    import app
    from app import registry
    from engines.base import DecodeAbandonedError

    alternate, decodes = _LaneEngine.build(monkeypatch)
    monkeypatch.setattr(app, "ALTERNATE_WAIT_MS", 2000.0)
    monkeypatch.setattr(registry, "alternate", lambda lang: alternate)
    pool = ThreadPoolExecutor(max_workers=1)
    submitted = []

    def submit(*args, **kwargs):
        submitted.append(pool.submit(*args, **kwargs))
        return submitted[-1]

    monkeypatch.setattr(app._alternate_pool, "submit", submit)

    def primary_fails(samples, hotwords=""):
        raise RuntimeError("onnx went away")

    monkeypatch.setattr(registry.get("vi"), "transcribe_with_pauses", primary_fails)

    assert alternate._lanes.acquire(blocking=False)
    try:
        with pytest.raises(RuntimeError, match="onnx went away"):
            _post_vi(client, webm_audio, alternates="true")
    finally:
        alternate._lanes.release()
    pool.shutdown(wait=True)

    assert len(submitted) == 1
    with pytest.raises(DecodeAbandonedError):
        submitted[0].result()
    assert decodes == []
    # And the lane went back: a fresh decode gets it at once.
    assert alternate._lanes.acquire(blocking=False)


def test_an_abandoned_decode_releases_its_lane_without_decoding(monkeypatch):
    import threading

    import numpy as np

    from engines.base import DecodeAbandonedError

    engine, decodes = _LaneEngine.build(monkeypatch)
    abandoned = threading.Event()
    samples = np.zeros(1600, dtype=np.float32)

    assert engine._lanes.acquire(blocking=False)
    errors: list[Exception] = []

    def decode():
        try:
            engine.transcribe(samples, abandoned=abandoned)
        except Exception as err:  # noqa: BLE001 — asserted below
            errors.append(err)

    waiter = threading.Thread(target=decode)
    waiter.start()
    abandoned.set()
    engine._lanes.release()
    waiter.join(timeout=2)

    assert [type(e) for e in errors] == [DecodeAbandonedError]
    assert decodes == []
    assert engine._lanes.acquire(blocking=False)

    # Abandoned before it ever asks for a lane: refused without waiting.
    engine._lanes.release()
    with pytest.raises(DecodeAbandonedError):
        engine.transcribe(samples, abandoned=abandoned)
    assert decodes == []
    # Not abandoned: decodes as usual.
    assert engine.transcribe(samples, abandoned=threading.Event()) == "xin chào các bạn"
    assert decodes == [1]


def test_a_shorter_lane_wait_caps_but_never_extends_the_engine_wait(monkeypatch):
    import time

    import numpy as np

    from engines.base import SttBusyError

    engine, _ = _LaneEngine.build(monkeypatch, lane_wait_ms="2000")
    samples = np.zeros(1600, dtype=np.float32)
    assert engine._lanes.acquire(blocking=False)

    started = time.perf_counter()
    with pytest.raises(SttBusyError, match="no lane within 50ms"):
        engine.transcribe(samples, lane_wait_ms=50)
    assert time.perf_counter() - started < 1.0

    short, _ = _LaneEngine.build(monkeypatch, lane_wait_ms="20")
    assert short._lanes.acquire(blocking=False)
    with pytest.raises(SttBusyError, match="no lane within 20ms"):
        short.transcribe(samples, lane_wait_ms=5000)


def test_a_gated_turn_runs_no_alternate(client, webm_audio, monkeypatch):
    # The sweep fixture is not speech, so the 300ms floor gates it (see
    # test_min_speech_ms_gates_a_non_speech_clip).
    from app import registry

    fake = _FakeAlternate()
    monkeypatch.setattr(registry, "alternate", lambda lang: fake)

    res = _post_vi(client, webm_audio, alternates="true", min_speech_ms="300")

    assert res.status_code == 200
    assert res.json()["text"] == ""
    assert "alternates" not in res.json()
    assert fake.calls == []


def test_the_two_decodes_overlap(client, webm_audio, monkeypatch):
    """Latency is the slower decode, not the sum: 0.4s each must finish well
    under 0.8s. The bound leaves room for a loaded runner, not for serializing."""
    import time

    from app import registry

    monkeypatch.setattr(registry, "alternate", lambda lang: _FakeAlternate(delay=0.4))
    _stub_primary(monkeypatch, delay=0.4)

    started = time.perf_counter()
    res = _post_vi(client, webm_audio, alternates="true")
    elapsed = time.perf_counter() - started

    assert res.json()["alternates"] == ["xin chào các bạn"]
    assert elapsed < 0.7, f"{elapsed*1000:.0f}ms — the alternate is serialized behind the primary"


def test_healthz_is_ready_without_any_alternate(client, monkeypatch):
    from app import registry

    monkeypatch.setattr(registry, "_alternates", {})

    res = client.get("/healthz")

    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert res.json()["alternates"] == []


def test_registry_without_alternate_weights_loads_and_is_ready(monkeypatch):
    """Unseeded weights are a warning: every primary loads, `ready` holds, and
    `alternate()` answers None instead of raising."""
    import engines.registry as registry_module
    from engines.base import SttEngine
    from engines.zipformer_vi_alternate import ZipformerViAlternate

    class _StubPrimary(SttEngine):
        lang = "vi"

        def load(self) -> None:
            self._recognizer = object()

    # Stub primaries: what is under test is the alternate's absence, and a
    # second real set of every model would cost this process gigabytes.
    monkeypatch.setattr(registry_module, "_ENGINE_TYPES", {"vi": _StubPrimary})
    monkeypatch.setattr(ZipformerViAlternate, "weights_present", staticmethod(lambda: False))
    registry = registry_module.EngineRegistry()
    registry.load_all()

    assert registry.ready
    assert registry.alternate("vi") is None
    assert registry.alternate_languages == []


@pytest.mark.skipif(
    not __import__("engines.zipformer_vi_alternate", fromlist=["x"])
    .ZipformerViAlternate.weights_present(),
    reason="alternate vi weights not seeded",
)
def test_the_seeded_alternate_loads_and_decodes(client, webm_audio):
    assert client.get("/healthz").json()["alternates"] == ["vi"]

    res = _post_vi(client, webm_audio, alternates="true")

    assert res.status_code == 200
    # The sweep is not speech; that the key is there and holds a string is the
    # real model's whole contract here.
    assert isinstance(res.json()["alternates"][0], str)


# ── Concurrency ──────────────────────────────────────────────────────────────
# The engine used to serialize every decode behind a lock; the API fans out
# many decodes per turn, so the lock queued them while the machine idled. These
# tests pin the property the fix bought: concurrent decodes overlap, and a
# saturated engine refuses rather than queues.


def test_concurrent_decodes_overlap(webm_audio, monkeypatch):
    """6 decodes through one engine must beat 6 serial decodes.

    The old lock made concurrent ~= serial (measured on prod: 0.94x for
    English, 0.84x for Vietnamese). The bound is 0.75 rather than the 0.60 the
    prod probe asserts, because CI hardware varies; anything at or near 1.0
    means the serialization is back.

    Parakeet, not Zipformer: its per-decode cost is several times higher, so
    the serial/concurrent ratio separates cleanly from timer noise on a loaded
    runner — with the fast Vietnamese model a partially-loaded CI box can
    legitimately land near the old serialized ratio.

    Threads are pinned to 2 for the same reason the deployment pairs few
    threads with many lanes: lanes and threads multiply, and 6 concurrent
    decodes each holding an 8-thread intra-op pool oversubscribe any machine —
    the same measurement that keeps prod at threads=4.
    """
    from concurrent.futures import ThreadPoolExecutor
    import time

    from audio.decode import decode_to_16k_mono
    from engines.parakeet_en import ParakeetEn

    # 3s of audio: long enough that per-decode timing is not dominated by
    # fixture noise.
    samples = decode_to_16k_mono(make_webm_opus(3.0))

    monkeypatch.setenv("LOCAL_STT_THREADS", "2")
    engine = ParakeetEn()
    engine.load()
    engine.transcribe(samples)  # warm the graph

    n = 6

    def run_concurrent() -> float:
        start = time.perf_counter()
        with ThreadPoolExecutor(max_workers=n) as pool:
            list(pool.map(lambda _: engine.transcribe(samples), range(n)))
        return time.perf_counter() - start

    # One discarded concurrent burst: the first pays thread-pool spin-up and
    # measured 0.72 where steady state sits at ~0.50 — close enough to the
    # bound to flake on a loaded machine.
    run_concurrent()

    start = time.perf_counter()
    for _ in range(n):
        engine.transcribe(samples)
    serial = time.perf_counter() - start
    concurrent = run_concurrent()

    assert concurrent < 0.75 * serial, (
        f"concurrent {concurrent*1000:.0f}ms vs serial {serial*1000:.0f}ms — "
        "decodes are serializing again"
    )


def test_saturated_engine_refuses_with_503(monkeypatch, webm_audio):
    """Every lane busy past the wait budget is a 503, not an invisible queue."""
    from types import SimpleNamespace

    import app as app_module
    from engines.base import SttBusyError

    class _BusyEngine:
        supports_hotwords = True

        def transcribe(self, samples, hotwords=""):
            raise SttBusyError("vi engine saturated: no lane within 2000ms")

        def transcribe_with_pauses(self, samples, hotwords=""):
            raise SttBusyError("vi engine saturated: no lane within 2000ms")

    monkeypatch.setattr(
        app_module,
        "registry",
        SimpleNamespace(
            ready=True,
            get=lambda lang: _BusyEngine(),
            # Lifespan calls these; no models are involved in this test.
            load_all=lambda: None,
            unload_all=lambda: None,
        ),
    )
    monkeypatch.setattr(
        app_module,
        "embedder",
        SimpleNamespace(loaded=True, load=lambda: None, unload=lambda: None),
    )
    with TestClient(app) as c:
        res = c.post(
            "/transcribe",
            files={"file": ("audio.webm", webm_audio, "audio/webm")},
            data={"language": "vi"},
        )
    assert res.status_code == 503
    assert "saturated" in res.json()["detail"]


def test_lane_wait_times_out_instead_of_queueing(monkeypatch):
    """Engine-level: a request that cannot get a lane within the budget raises.

    Drives the engine directly with a 1-lane, 10ms budget so the outcome is
    timing-deterministic: the lane is held by the test itself.
    """
    import numpy as np

    from engines.base import SttBusyError, SttEngine

    monkeypatch.setenv("LOCAL_STT_CONCURRENCY", "1")
    monkeypatch.setenv("LOCAL_STT_LANE_WAIT_MS", "10")

    class _NoopEngine(SttEngine):
        lang = "xx"

        def load(self) -> None:
            # `loaded` only checks the field; the busy path never reaches the
            # recognizer.
            self._recognizer = object()

    engine = _NoopEngine()
    engine.load()
    # Hold the only lane, then ask for another: it must time out, not block.
    assert engine._lanes.acquire(blocking=False)
    with pytest.raises(SttBusyError):
        engine.transcribe(np.zeros(1600, dtype=np.float32))

