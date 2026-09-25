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


@pytest.fixture(scope="module")
def client():
    # `with` triggers lifespan → loads both models once for the whole module.
    with TestClient(app) as c:
        yield c


def test_healthz_ok(client):
    res = client.get("/healthz")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


@pytest.mark.parametrize("language", ["vi", "en"])
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

    monkeypatch.setattr(engine, "transcribe", capture)
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

    monkeypatch.setattr(engine, "transcribe", capture)
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


def test_unsupported_language_400(client, webm_audio):
    res = client.post(
        "/transcribe",
        files={"file": ("audio.webm", webm_audio, "audio/webm")},
        data={"language": "fr"},
    )
    assert res.status_code == 400


def test_unsupported_pass_400(client, webm_audio):
    res = client.post(
        "/transcribe",
        files={"file": ("audio.webm", webm_audio, "audio/webm")},
        data={"language": "en", "pass": "draft"},
    )
    assert res.status_code == 400


# ── Passes ───────────────────────────────────────────────────────────────────
# English finals and English live partials are answered by different models:
# the best final model costs too much per decode for the 300ms re-read cadence.


def test_english_passes_route_to_their_engines(client):
    from app import registry
    from engines.moonshine_en import MoonshineEn
    from engines.parakeet_en import ParakeetEn

    assert isinstance(registry.get("en", "final"), ParakeetEn)
    assert isinstance(registry.get("en", "partial"), MoonshineEn)
    # A request that predates the field is a final one.
    assert registry.get("en") is registry.get("en", "final")
    # Vietnamese has one engine for both, and it is ONE instance: two would
    # double the weights and split the decode lanes.
    assert registry.get("vi", "final") is registry.get("vi", "partial")


@pytest.mark.parametrize(
    ("form_pass", "answered_by"), [(None, "final"), ("final", "final"), ("partial", "partial")]
)
def test_the_pass_field_picks_the_engine(
    client, webm_audio, monkeypatch, form_pass, answered_by
):
    from app import registry

    calls = []
    for name in ("final", "partial"):
        engine = registry.get("en", name)
        monkeypatch.setattr(
            engine, "transcribe", lambda samples, hotwords="", n=name: calls.append(n) or n
        )
    data = {"language": "en"} | ({"pass": form_pass} if form_pass else {})
    res = client.post(
        "/transcribe", files={"file": ("audio.webm", webm_audio, "audio/webm")}, data=data
    )

    assert res.status_code == 200
    assert calls == [answered_by]


def test_rollback_flag_keeps_parakeet_unloaded(monkeypatch):
    """LOCAL_STT_EN_FINAL=moonshine sends English finals back to Moonshine
    without ever constructing Parakeet — the rollback must not need its weights."""
    from engines import registry as registry_module
    from engines.moonshine_en import MoonshineEn
    from engines.parakeet_en import ParakeetEn
    from engines.zipformer_vi import ZipformerVi

    def fake_load(self):
        # Both attributes: the vi engine counts as loaded only with its biased
        # recognizer too.
        self._recognizer = self._biased_recognizer = object()

    def forbidden(self):
        raise AssertionError("Parakeet loaded while rolled back")

    monkeypatch.setenv("LOCAL_STT_EN_FINAL", "moonshine")
    monkeypatch.setattr(MoonshineEn, "load", fake_load)
    monkeypatch.setattr(ZipformerVi, "load", fake_load)
    monkeypatch.setattr(ParakeetEn, "load", forbidden)

    reg = registry_module.EngineRegistry()
    reg.load_all()

    assert reg.ready
    assert reg.get("en", "final") is reg.get("en", "partial")
    assert isinstance(reg.get("en", "final"), MoonshineEn)


def test_unknown_rollback_value_refuses_to_start(monkeypatch):
    from engines import registry as registry_module

    monkeypatch.setenv("LOCAL_STT_EN_FINAL", "whisper")
    with pytest.raises(ValueError, match="LOCAL_STT_EN_FINAL"):
        registry_module.EngineRegistry().load_all()


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

    Moonshine, not Zipformer: its per-decode cost is several times higher, so
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
    from engines.moonshine_en import MoonshineEn

    # 3s of audio: long enough that per-decode timing is not dominated by
    # fixture noise.
    samples = decode_to_16k_mono(make_webm_opus(3.0))

    monkeypatch.setenv("LOCAL_STT_THREADS", "2")
    engine = MoonshineEn()
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

    monkeypatch.setattr(
        app_module,
        "registry",
        SimpleNamespace(
            ready=True,
            get=lambda lang, pass_="final": _BusyEngine(),
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
