"""The Gemini Decision LID arm: WAV encoding, key rotation, the call cap, and the arbiter rule."""

from __future__ import annotations

import importlib.util
import io
import json
import sys
import wave
from pathlib import Path

import numpy as np
import pytest

BENCH_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BENCH_ROOT / "scripts"))


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


arm = _load("gemini_decision_arm", BENCH_ROOT / "arms" / "gemini_decision" / "arm.py")
arbiter = _load("make_arbiter_arm", BENCH_ROOT / "scripts" / "make_arbiter_arm.py")

OK = json.dumps({"answers": {"lang": {"probabilities": {"vi": 0.8, "en": 0.15, "zh": 0.05}}},
                 "usage": {"total_input_tokens": 100}}).encode()


class _Response:
    def __init__(self, status: int, body: bytes) -> None:
        self.status, self.body = status, body

    def read(self) -> bytes:
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        return None


def _opener(statuses: list[int], keys_used: list[str]):
    import urllib.error

    def opener(request, timeout):
        keys_used.append(request.get_header("X-goog-api-key"))
        status = statuses.pop(0)
        if status != 200:
            raise urllib.error.HTTPError(request.full_url, status, "x", {}, io.BytesIO(b"{}"))
        return _Response(200, OK)

    return opener


def test_wav_round_trip() -> None:
    samples = np.linspace(-1, 1, 1600, dtype=np.float32)
    with wave.open(io.BytesIO(arm.wav_bytes(samples))) as wav:
        assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 16000)
        decoded = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2") / 32767
    assert np.allclose(decoded, samples, atol=1e-4)


def test_rotates_key_on_429_and_logs_every_attempt(tmp_path: Path) -> None:
    keys_used: list[str] = []
    log = tmp_path / "http.jsonl"
    client = arm.Client(["a", "b"], log, cap=10, opener=_opener([429, 200], keys_used), sleep=lambda s: None)
    assert client.ask(b"wav") == {"vi": 0.8, "en": 0.15, "zh": 0.05}
    assert keys_used == ["a", "b"]
    assert [json.loads(line)["status"] for line in log.read_text().splitlines()] == [429, 200]


def test_cap_counts_attempts_already_logged(tmp_path: Path) -> None:
    log = tmp_path / "http.jsonl"
    log.write_text('{"id": "x", "status": 200}\n' * 3)
    client = arm.Client(["a"], log, cap=3, opener=_opener([200], []), sleep=lambda s: None)
    with pytest.raises(arm.CapReached):
        client.ask(b"wav")


def test_rejected_turn_is_logged_and_scored_uniform(tmp_path: Path) -> None:
    client = arm.Client(["a"], tmp_path / "http.jsonl", cap=10, opener=_opener([400], []), sleep=lambda s: None)
    failed = tmp_path / "failed.jsonl"
    probs = arm.make_probs_fn(client, failed, ["t1"])(np.zeros(160, dtype=np.float32))
    assert probs == arm.UNIFORM
    assert json.loads(failed.read_text())["id"] == "t1"


def test_arbiter_replaces_only_unsure_whole_turns() -> None:
    full = "en+vi+zh"
    whisper = [
        {"id": "sure", "prefix_ms": None, "probs": {full: {"vi": 0.9, "en": 0.05, "zh": 0.05}}, "latency_ms": 100},
        {"id": "unsure", "prefix_ms": None, "probs": {full: {"vi": 0.45, "en": 0.4, "zh": 0.15}}, "latency_ms": 100},
        {"id": "unsure", "prefix_ms": 600, "probs": {full: {"vi": 0.4, "en": 0.5, "zh": 0.1}}, "latency_ms": 90},
    ]
    gemini = {"sure": {"vi": 0.1, "en": 0.8, "zh": 0.1}, "unsure": {"vi": 0.95, "en": 0.04, "zh": 0.01}}
    rows, replaced = arbiter.arbiter_rows(whisper, gemini, {"sure": 700, "unsure": 800})
    assert replaced == 1
    assert rows[0] == whisper[0]
    assert rows[1]["probs"][full] == gemini["unsure"] and rows[1]["latency_ms"] == 900
    assert rows[2] == whisper[2]
