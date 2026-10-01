"""POST /restore: punctuation and case for the Vietnamese display.

The accuracy claims in `punctuation/restorer.py` come from a ruler of real
sessions scored against Scribe, not from these tests. What these pin is the
contract around the model — that it never changes the words, that the context
is read and not returned, that the caller's mixed-case terms apply — and a
handful of the exact cases that motivated it, so a model or revision swap that
loses them fails here.
"""
import os
import re

import pytest

import app as sidecar
from punctuation.dewpoint import Punctuator
from punctuation.restorer import (
    LOCK_WAIT_S,
    DisplayRestorer,
    _lower_mid_sentence_capitals,
    mixed_case_terms,
)

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


class TaggedPunctuator:
    """Stands in for the model with fixed labels, so the code AROUND the model —
    the spoken-number guard — is pinned exactly, whatever a model swap predicts."""

    gazetteer: dict = {}
    _close = staticmethod(Punctuator._close)

    def __init__(self, labels: list[tuple[str, str]]) -> None:
        self.labels = labels

    def predict(self, words: list[str], lang: str) -> dict:
        assert len(words) == len(self.labels)
        return {
            "punct": [p for p, _ in self.labels],
            "punct_scores": [[1.0, 0, 0, 0, 0]] * len(words),
            "case": [c for _, c in self.labels],
        }


def tagged(text: str, labels: list[tuple[str, str]]) -> str:
    restorer = DisplayRestorer()
    restorer._punctuator = TaggedPunctuator(labels)
    return restorer.restore(text)


def test_a_question_before_an_ambiguous_number_word_stays_a_boundary():
    # "không" is the question particle and "một" is "a": nothing here is a number.
    text = "có khỏe không một tuần nữa gặp"
    labels = [("O", "CAP"), ("O", "LOWER"), ("QUESTION", "LOWER"), ("O", "CAP"),
              ("O", "LOWER"), ("O", "LOWER"), ("PERIOD", "LOWER")]

    assert tagged(text, labels) == "Có khỏe không? Một tuần nữa gặp."


def test_a_full_stop_between_ambiguous_number_words_stays_a_boundary():
    text = "anh có đi không không em bận"
    labels = [("O", "CAP"), ("O", "LOWER"), ("O", "LOWER"), ("PERIOD", "LOWER"),
              ("COMMA", "CAP"), ("O", "LOWER"), ("PERIOD", "LOWER")]

    assert tagged(text, labels) == "Anh có đi không. Không, em bận."


def test_a_question_mark_survives_inside_an_unambiguous_run():
    text = "có không hai tuần nữa"
    labels = [("O", "CAP"), ("QUESTION", "LOWER"), ("O", "CAP"), ("O", "LOWER"),
              ("PERIOD", "LOWER")]

    assert tagged(text, labels) == "Có không? Hai tuần nữa."


def test_clears_marks_inside_a_spoken_number_the_tagger_split():
    text = "giá là một trăm hai mươi nghìn đồng"
    labels = [("O", "CAP"), ("O", "LOWER"), ("O", "LOWER"), ("COMMA", "LOWER"),
              ("O", "LOWER"), ("PERIOD", "LOWER"), ("O", "CAP"), ("PERIOD", "LOWER")]

    assert tagged(text, labels) == "Giá là một trăm hai mươi nghìn đồng."


def test_waits_long_enough_for_one_restore_ahead_but_inside_the_callers_budget():
    # One inference is ~110 ms at p95 and the API stops waiting at 300 ms: a
    # request behind one other restore must be served, not refused.
    assert 0.11 <= LOCK_WAIT_S <= 0.2


SENTENCE_END = {"PERIOD", "QUESTION", "EXCLAM"}


def lowered(words: list[str], punct: list[str], fixed: frozenset[int] = frozenset()) -> list[str]:
    out = list(words)
    _lower_mid_sentence_capitals(out, punct, set(fixed), SENTENCE_END)
    return out


def test_lowers_a_common_word_after_a_comma_but_not_a_name():
    assert lowered(["Anh", "Xin", "kính"], ["COMMA", "O", "O"]) == ["Anh", "xin", "kính"]
    # "Berlin" is no common word, and "Hà" is followed by the rest of its name.
    assert lowered(["Đức", "Berlin", "đẹp"], ["COMMA", "O", "O"]) == ["Đức", "Berlin", "đẹp"]
    assert lowered(["ở", "Hà", "Nội"], ["COMMA", "O", "O"]) == ["ở", "Hà", "Nội"]


def test_lowers_a_title_before_a_name_unless_it_is_part_of_one():
    assert lowered(["chào", "Anh", "Tuấn"], ["O", "O", "O"]) == ["chào", "anh", "Tuấn"]
    assert lowered(["ông", "Hoàng", "Anh", "Tuấn"], ["O", "O", "O", "O"]) == ["ông", "Hoàng", "Anh", "Tuấn"]


def test_leaves_sentence_starts_capitals_and_spelled_terms_alone():
    assert lowered(["xong", "Xin", "chào"], ["PERIOD", "O", "O"]) == ["xong", "Xin", "chào"]
    assert lowered(["vâng", "AI", "nói"], ["COMMA", "O", "O"]) == ["vâng", "AI", "nói"]
    assert lowered(["vâng", "Xin", "chào"], ["COMMA", "O", "O"], fixed=frozenset({1})) == ["vâng", "Xin", "chào"]


@model_tests
def test_greets_without_a_capital_mid_sentence(client):
    # Recorded on prod: the model wrote "Anh Tuấn. Anh, Xin kính chào".
    text = "vâng xin chào anh tuấn anh xin kính chào quý vị khán giả"
    restored = restore(client, text).json()["text"]

    assert "Xin kính" not in restored
    assert "anh Tuấn" in restored
    assert words(restored) == words(text)


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

    # The model tags a word lower, Capital or UPPER, so the mixed-case "OpenAI"
    # is not its to produce: the API takes it from the turn's translation.
    assert "AI của Openai" in tech
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


def _seed_partially(seed, root):
    out_dir = root / "dewpoint-mmbert-base"
    for filename in seed.DEWPOINT_FILES:
        (out_dir / filename).parent.mkdir(parents=True, exist_ok=True)
        (out_dir / filename).write_text("{}")
    return out_dir


def _no_download(*args, **kwargs):
    raise AssertionError(f"downloaded {args}")


def test_a_partial_seed_on_a_read_only_mount_downloads_nothing(monkeypatch, tmp_path, capsys):
    # The seed was killed during the graph step; the runtime mounts the models
    # read-only and runs the seed on every start. It must not fetch 1.2 GB to
    # find out it cannot write the result.
    import scripts.download_models as seed

    monkeypatch.setattr(seed, "MODELS_DIR", tmp_path)
    monkeypatch.setattr(seed, "hf_hub_download", _no_download)
    out_dir = _seed_partially(seed, tmp_path)
    monkeypatch.setattr(seed.os, "access", lambda path, mode: False)

    seed.fetch_dewpoint()

    assert "not writable" in capsys.readouterr().out
    assert not (out_dir / seed.DEWPOINT_ONNX).exists()


def test_a_complete_seed_fetches_nothing(monkeypatch, tmp_path, capsys):
    import scripts.download_models as seed

    monkeypatch.setattr(seed, "MODELS_DIR", tmp_path)
    monkeypatch.setattr(seed, "hf_hub_download", _no_download)
    out_dir = _seed_partially(seed, tmp_path)
    (out_dir / seed.DEWPOINT_ONNX).parent.mkdir(parents=True, exist_ok=True)
    (out_dir / seed.DEWPOINT_ONNX).write_bytes(b"")

    seed.fetch_dewpoint()

    assert "ready (cached)" in capsys.readouterr().out


def test_refuses_a_language_it_does_not_serve(client):
    res = client.post("/restore", json={"text": "hello there", "language": "en"})

    assert res.status_code == 400


@model_tests
def test_reports_restore_readiness_without_gating_on_it(client):
    body = client.get("/healthz").json()

    assert body["restore"] is True
