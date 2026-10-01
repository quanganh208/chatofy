"""POST /restore: punctuation and case for the Vietnamese display.

The accuracy claims in `punctuation/restorer.py` come from a ruler of real
sessions scored against Scribe, not from these tests. What these pin is the
contract around the model — that it never changes the words, that the context
is read and not returned, that brand forms and the caller's terms apply — and a
handful of the exact cases that motivated it, so a model or revision swap that
loses them fails here.
"""
import os
import re

import pytest

import app as sidecar
from punctuation.restorer import mixed_case_terms

model_tests = pytest.mark.skipif(
    os.environ.get("LOCAL_STT_SKIP_MODEL_TESTS") == "1",
    reason="model tests skipped via LOCAL_STT_SKIP_MODEL_TESTS",
)


def words(text: str) -> list[str]:
    return re.findall(r"[^\W_]+", text.lower())


def restore(client, text: str, **extra):
    return client.post("/restore", json={"text": text, "language": "vi", **extra})


def test_only_mixed_case_single_words_become_forms():
    # "Long" is also an ordinary word, "AI" is also "who", "Hà Nội" is two words:
    # none of them may be forced onto every occurrence.
    assert mixed_case_terms(["VNeID", "iPhone", "Long", "AI", "Hà Nội", "", "a/b"]) == {
        "vneid": "VNeID",
        "iphone": "iPhone",
    }


@model_tests
def test_never_changes_the_words(client):
    text = "thưa quý vị lần đầu tiên một công ty dẫn đầu về ai công khai thừa nhận một sự cố"
    res = restore(client, text)

    assert res.status_code == 200
    assert words(res.json()["text"]) == words(text)


@model_tests
def test_reads_ai_as_the_technology_and_as_who(client):
    tech = restore(client, "mô hình ai của openai đã hoạt động bất thường").json()["text"]
    who = restore(client, "em không biết ai là người đã để quên cái ví này").json()["text"]

    assert "AI của OpenAI" in tech
    assert " ai " in who


@model_tests
def test_does_not_open_a_continuation_with_a_capital(client):
    # A forced cut landed mid-clause. Without the context the piece reads as a
    # new sentence; with it, the seam stays lowercase.
    piece = "bắt đầu có hiệu lực liên quan trực tiếp đến việc sử dụng tài khoản"
    context = "từ ngày mai một số quy định mới về định danh và xác thực điện tử"

    alone = restore(client, piece).json()["text"]
    joined = restore(client, piece, context=context).json()["text"]

    assert alone.startswith("Bắt")
    assert joined.startswith("bắt")
    assert words(joined) == words(piece)


@model_tests
def test_applies_the_callers_mixed_case_terms(client):
    res = restore(client, "dữ liệu được đồng bộ lên chatofy cloud", terms=["ChatoFy"])

    assert "ChatoFy" in res.json()["text"]


@model_tests
def test_keeps_a_spoken_number_in_one_piece(client):
    # A mark inside a spoken number splits it for the ITN downstream: 120.000
    # was measured coming out as "100, 20.000" before this was guarded.
    for text in (
        "giá là một trăm hai mươi nghìn đồng",
        "số điện thoại của tôi là không chín không một hai ba bốn năm sáu bảy",
    ):
        restored = restore(client, text).json()["text"]
        number = re.search(r"(một trăm.*nghìn|không chín.*bảy)", restored, re.IGNORECASE)
        assert number is not None and not re.search(r"[,.?!]", number.group(1)), restored


@model_tests
def test_refuses_rather_than_queues_when_busy(client):
    # Holding a worker for an answer the caller stopped waiting for would let a
    # display feature starve /transcribe of threads.
    sidecar.restorer._lock.acquire()
    try:
        res = restore(client, "xin chào")
    finally:
        sidecar.restorer._lock.release()

    assert res.status_code == 429


@model_tests
def test_unloaded_restorer_refuses_without_failing_health(client):
    loaded, sidecar.restorer._punctuator = sidecar.restorer._punctuator, None
    try:
        res = restore(client, "xin chào")
        health = client.get("/healthz")
    finally:
        sidecar.restorer._punctuator = loaded

    assert res.status_code == 503
    assert health.status_code == 200
    assert health.json()["restore"] is False


def test_a_failed_dewpoint_fetch_does_not_stop_the_seed(monkeypatch, capsys):
    import scripts.download_models as seed

    def boom():
        raise OSError("read-only file system")

    monkeypatch.setattr(seed, "_fetch_dewpoint", boom)
    seed.fetch_dewpoint()

    assert "skipped" in capsys.readouterr().out


def test_refuses_a_language_it_does_not_serve(client):
    res = client.post("/restore", json={"text": "hello there", "language": "en"})

    assert res.status_code == 400


@model_tests
def test_reports_restore_readiness_without_gating_on_it(client):
    body = client.get("/healthz").json()

    assert body["restore"] is True
