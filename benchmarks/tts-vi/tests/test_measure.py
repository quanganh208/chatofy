"""Pure-function coverage. Model loading is the smoke test's job, not pytest's."""

import json

import pytest

from tts_vi_bench.measure import (
    latency_stats,
    load_sentences,
    sentence_set_name,
)


def test_latency_stats_orders_percentiles():
    stats = latency_stats([0.1, 0.2, 0.3, 0.4, 1.0])
    assert stats["p50_s"] == pytest.approx(0.3)
    assert stats["mean_s"] == pytest.approx(0.4)
    assert stats["p95_s"] >= stats["p50_s"]


def test_latency_stats_rejects_empty():
    with pytest.raises(ValueError):
        latency_stats([])


def _write(tmp_path, name, rows):
    path = tmp_path / name
    path.write_text(
        "# a policy header the loader must skip\n"
        + "\n".join(json.dumps(r, ensure_ascii=False) for r in rows)
        + "\n",
        encoding="utf-8",
    )
    return path


def test_load_sentences_takes_the_declared_id(tmp_path):
    """The id comes from the row, never from its position.

    This is the divergence from the English harness's loader, and it is the
    whole reason two sentence sets can share one results tree: positional ids
    would make conversational and VIVOS rows collide on filename and overwrite
    each other's audio.
    """
    path = _write(
        tmp_path,
        "sentences-vivos.jsonl",
        [
            {"id": "vivos-VIVOSDEV01_R044", "text": "Một hai ba.", "ref_text": "MỘT HAI BA"},
            {"id": "vivos-VIVOSDEV02_R009", "text": "Bốn năm sáu.", "ref_text": "BỐN NĂM SÁU"},
        ],
    )
    got = load_sentences(path)
    assert [s.id for s in got] == ["vivos-VIVOSDEV01_R044", "vivos-VIVOSDEV02_R009"]
    assert got[0].ref_text == "MỘT HAI BA"
    assert got[0].text == "Một hai ba."


def test_load_sentences_carries_tags(tmp_path):
    path = _write(
        tmp_path,
        "sentences-conversational.jsonl",
        [{"id": "conv-001", "text": "Xin chào.", "ref_text": "Xin chào.",
          "tags": ["short", "code-switch"]}],
    )
    assert load_sentences(path)[0].tags == ("short", "code-switch")


def test_load_sentences_rejects_duplicate_ids(tmp_path):
    path = _write(
        tmp_path,
        "sentences-dup.jsonl",
        [
            {"id": "conv-001", "text": "A.", "ref_text": "A."},
            {"id": "conv-001", "text": "B.", "ref_text": "B."},
        ],
    )
    with pytest.raises(ValueError, match="duplicate sentence id"):
        load_sentences(path)


def test_load_sentences_rejects_empty_reference(tmp_path):
    path = _write(
        tmp_path,
        "sentences-empty.jsonl",
        [{"id": "conv-001", "text": "A.", "ref_text": "   "}],
    )
    with pytest.raises(ValueError, match="empty text or ref_text"):
        load_sentences(path)


def test_load_sentences_rejects_a_file_of_only_comments(tmp_path):
    path = tmp_path / "sentences-none.jsonl"
    path.write_text("# header only\n\n", encoding="utf-8")
    with pytest.raises(ValueError, match="no sentences"):
        load_sentences(path)


def test_sentence_set_name_strips_the_prefix(tmp_path):
    assert sentence_set_name(tmp_path / "sentences-vivos.jsonl") == "vivos"
    assert sentence_set_name(tmp_path / "sentences-conversational.jsonl") == "conversational"
