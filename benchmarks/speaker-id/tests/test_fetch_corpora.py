"""Tests for the corpus fetch script's decision logic.

Nothing here touches the network. What is worth testing is the part that would
be dangerous if wrong: that the script REFUSES a gated dataset rather than
finding a way around it, and that it tells the truth about what is on disk.

The refusal is the load-bearing behaviour. Accepting a dataset licence is the
user's act; a script that silently worked around the gate would make that
decision for them and leave no trace that it had.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

BENCH_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = BENCH_ROOT / "scripts" / "fetch_corpora.py"


def _load_module():
    """Import the script by path — `scripts/` is not a package."""
    spec = importlib.util.spec_from_file_location("fetch_corpora", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["fetch_corpora"] = module
    spec.loader.exec_module(module)
    return module


fetch_corpora = _load_module()


@pytest.fixture(autouse=True)
def _no_ambient_token(monkeypatch: pytest.MonkeyPatch) -> None:
    """A developer's real HF_TOKEN must not decide what these tests measure."""
    for name in fetch_corpora.HF_TOKEN_VARS:
        monkeypatch.delenv(name, raising=False)


# --- the gate refusal -----------------------------------------------------


def test_refuses_gated_dataset_without_a_token(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError) as excinfo:
        fetch_corpora.fetch_voxvietnam(tmp_path, shards=None)

    message = str(excinfo.value)
    assert "GATED" in message
    assert "will not accept the dataset's conditions for you" in message
    # The message has to be actionable, not merely correct.
    assert "huggingface.co/settings/tokens" in message
    assert "cc-by-nc-4.0" in message


@pytest.mark.parametrize("variable", fetch_corpora.HF_TOKEN_VARS)
def test_token_is_read_from_each_supported_variable(
    variable: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(variable, "hf_example")
    assert fetch_corpora._hf_token() == "hf_example"


def test_no_token_reads_as_absent() -> None:
    assert fetch_corpora._hf_token() is None


def test_empty_token_reads_as_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    """An exported-but-empty variable must not count as consent."""
    monkeypatch.setenv("HF_TOKEN", "")
    assert fetch_corpora._hf_token() is None


def test_test_split_pattern_excludes_the_train_splits() -> None:
    """The allow-pattern is what keeps this to shards, not 44GB."""
    pattern = fetch_corpora.VOXVIETNAM_TEST_PATTERN
    assert pattern == "data/test-*"
    assert "train" not in pattern


# --- Vietnam-Celeb verification -------------------------------------------


def test_reports_every_expected_file_missing_on_an_empty_directory(tmp_path: Path) -> None:
    missing = fetch_corpora.check_vietnam_celeb(tmp_path)
    assert set(missing) == set(fetch_corpora.VIETNAM_CELEB_EXPECTED)


def test_reports_nothing_missing_when_all_files_are_present(tmp_path: Path) -> None:
    for name in fetch_corpora.VIETNAM_CELEB_EXPECTED:
        (tmp_path / name).write_text("x", encoding="utf-8")
    assert fetch_corpora.check_vietnam_celeb(tmp_path) == []


def test_reports_only_the_absent_files(tmp_path: Path) -> None:
    (tmp_path / "vietnam-celeb-e.txt").write_text("x", encoding="utf-8")
    missing = fetch_corpora.check_vietnam_celeb(tmp_path)

    assert "vietnam-celeb-e.txt" not in missing
    assert "vietnam-celeb-h.txt" in missing


def test_expected_files_include_both_trial_lists() -> None:
    """The H list is the one Checkpoint 1 reads; losing it would be quiet."""
    assert "vietnam-celeb-e.txt" in fetch_corpora.VIETNAM_CELEB_EXPECTED
    assert "vietnam-celeb-h.txt" in fetch_corpora.VIETNAM_CELEB_EXPECTED


def test_notice_states_the_licence_is_unresolved() -> None:
    notice = fetch_corpora.VIETNAM_CELEB_NOTICE
    assert "licence is unstated" in notice.lower() or "LICENCE" in notice
    assert "Unstated is not permissive" in notice


# --- exit codes -----------------------------------------------------------


def test_missing_vietnam_celeb_alone_is_not_a_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """It is a manual, licence-unresolved download; VoxVietnam alone suffices.

    Exiting non-zero for it would train the reader to ignore this exit code,
    which is the same code that reports a genuinely failed fetch.
    """
    monkeypatch.setattr(fetch_corpora, "fetch_voxvietnam", lambda target, shards: 38)
    monkeypatch.setattr(
        sys, "argv", ["fetch_corpora.py", "--corpora-dir", str(tmp_path)]
    )
    assert fetch_corpora.main() == 0


def test_failed_voxvietnam_fetch_exits_non_zero(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _boom(target: Path, shards: int | None) -> int:
        raise RuntimeError("gated")

    monkeypatch.setattr(fetch_corpora, "fetch_voxvietnam", _boom)
    monkeypatch.setattr(
        sys, "argv", ["fetch_corpora.py", "--corpora-dir", str(tmp_path)]
    )
    assert fetch_corpora.main() == 1


def test_zero_shards_landing_is_a_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A 'successful' fetch that downloaded nothing is not a success.

    Without this, a bad allow-pattern would report 0 shards and exit 0, and the
    screen would then fail far away from the cause.
    """
    monkeypatch.setattr(fetch_corpora, "fetch_voxvietnam", lambda target, shards: 0)
    monkeypatch.setattr(
        sys, "argv", ["fetch_corpora.py", "--corpora-dir", str(tmp_path)]
    )
    assert fetch_corpora.main() == 1


def test_skip_flag_avoids_the_gated_fetch_entirely(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _must_not_run(target: Path, shards: int | None) -> int:
        raise AssertionError("--skip-voxvietnam still attempted the gated fetch")

    monkeypatch.setattr(fetch_corpora, "fetch_voxvietnam", _must_not_run)
    monkeypatch.setattr(
        sys,
        "argv",
        ["fetch_corpora.py", "--corpora-dir", str(tmp_path), "--skip-voxvietnam"],
    )
    assert fetch_corpora.main() == 0


@pytest.mark.parametrize("shards", ["0", "-1"])
def test_nonsense_shard_counts_are_rejected(
    shards: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        sys,
        "argv",
        ["fetch_corpora.py", "--corpora-dir", str(tmp_path), "--shards", shards],
    )
    assert fetch_corpora.main() == 2
