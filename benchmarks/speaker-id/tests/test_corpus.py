"""Tests for corpus indexing and addressing.

The index is what every later phase samples from, so a truncated or reordered
one does not fail loudly — it silently shrinks the population the gate describes.
These tests are mostly about that failure mode.
"""

from __future__ import annotations

import csv
from pathlib import Path

import pytest

from speaker_bench.corpus import (
    INDEX_FIELDS,
    Utterance,
    index_gap,
    load_index,
    shard_paths,
)


def _write_index(path: Path, rows: list[dict]) -> Path:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(INDEX_FIELDS))
        writer.writeheader()
        writer.writerows(rows)
    return path


def _row(order: int, speaker: str = "A", duration: float = 3.0) -> dict:
    return {
        "speaker": speaker,
        "shard": order // 100,
        "row": order % 100,
        "order": order,
        "duration_s": f"{duration:.4f}",
    }


# --- index integrity ------------------------------------------------------


def test_load_index_reads_a_complete_run(tmp_path: Path) -> None:
    path = _write_index(tmp_path / "index.csv", [_row(i) for i in range(5)])
    index = load_index(path)

    assert [u.order for u in index] == [0, 1, 2, 3, 4]
    assert all(isinstance(u, Utterance) for u in index)


def test_load_index_rejects_an_interrupted_scan(tmp_path: Path) -> None:
    """A gap means the scan died partway.

    Sampling from it would silently draw on a smaller corpus than reported, and
    every count printed beside an EER would be wrong without anything failing.
    """
    rows = [_row(i) for i in range(5)] + [_row(9)]
    path = _write_index(tmp_path / "gap.csv", rows)

    with pytest.raises(ValueError, match="complete 0..N-1 run"):
        load_index(path)


def test_load_index_rejects_an_index_not_starting_at_zero(tmp_path: Path) -> None:
    path = _write_index(tmp_path / "offset.csv", [_row(i) for i in range(3, 8)])
    with pytest.raises(ValueError, match="complete 0..N-1 run"):
        load_index(path)


def test_load_index_rejects_a_reordered_index(tmp_path: Path) -> None:
    """Order is the channel proxy; shuffling it makes the gap rule meaningless."""
    rows = [_row(i) for i in (0, 2, 1, 3)]
    path = _write_index(tmp_path / "shuffled.csv", rows)

    with pytest.raises(ValueError, match="complete 0..N-1 run"):
        load_index(path)


def test_load_index_rejects_an_empty_file(tmp_path: Path) -> None:
    path = _write_index(tmp_path / "empty.csv", [])
    with pytest.raises(ValueError, match="empty index"):
        load_index(path)


def test_load_index_preserves_types(tmp_path: Path) -> None:
    path = _write_index(tmp_path / "typed.csv", [_row(0, "spk-7", 2.5)])
    utterance = load_index(path)[0]

    assert utterance.speaker == "spk-7"
    assert isinstance(utterance.order, int)
    assert utterance.duration_s == pytest.approx(2.5)


# --- addressing -----------------------------------------------------------


def test_index_gap_is_symmetric() -> None:
    a = Utterance("A", 0, 0, 10, 3.0)
    b = Utterance("A", 0, 0, 40, 3.0)

    assert index_gap(a, b) == index_gap(b, a) == 30


def test_index_gap_of_an_utterance_with_itself_is_zero() -> None:
    a = Utterance("A", 0, 0, 10, 3.0)
    assert index_gap(a, a) == 0


def test_utterance_is_hashable_and_frozen() -> None:
    """Sampling keys utterances into sets; a mutable one would break that."""
    a = Utterance("A", 0, 0, 1, 3.0)
    assert {a, Utterance("A", 0, 0, 1, 3.0)} == {a}
    with pytest.raises(AttributeError):
        a.order = 5  # type: ignore[misc]


# --- shard discovery ------------------------------------------------------


def test_shard_paths_names_the_fetch_script_when_the_corpus_is_absent(
    tmp_path: Path,
) -> None:
    """The corpus needs a gated download, so the error must say how."""
    with pytest.raises(FileNotFoundError, match="fetch_corpora"):
        shard_paths(tmp_path)


def test_shard_paths_are_sorted(tmp_path: Path) -> None:
    """Scan order defines `order`, which defines the channel proxy."""
    data = tmp_path / "data"
    data.mkdir()
    for name in ("test-00002-of-00003.parquet", "test-00000-of-00003.parquet",
                 "test-00001-of-00003.parquet"):
        (data / name).write_bytes(b"")

    assert [p.name for p in shard_paths(tmp_path)] == [
        "test-00000-of-00003.parquet",
        "test-00001-of-00003.parquet",
        "test-00002-of-00003.parquet",
    ]


def test_shard_paths_ignores_other_splits(tmp_path: Path) -> None:
    """Fetching only the test split is what keeps this to 4.3GB of 44GB."""
    data = tmp_path / "data"
    data.mkdir()
    (data / "test-00000-of-00001.parquet").write_bytes(b"")
    (data / "train-00000-of-00100.parquet").write_bytes(b"")

    assert [p.name for p in shard_paths(tmp_path)] == ["test-00000-of-00001.parquet"]
