import subprocess
import sys
from pathlib import Path

import pytest

import run_bakeoff

BENCH = Path(__file__).resolve().parent.parent


def test_limit_with_run_tag_exits_nonzero():
    proc = subprocess.run([sys.executable, "run_bakeoff.py", "--limit", "1", "--run-tag", "x", "--arms", "turn_facts"],
                          cwd=BENCH, capture_output=True, text=True)
    assert proc.returncode != 0
    assert "smoke" in proc.stderr


def test_limit_goes_to_smoke_only():
    out = run_bakeoff.output_dir(None, 5, private=False)
    assert out.parent == run_bakeoff.RESULTS / "smoke"


def test_existing_tag_is_never_overwritten(tmp_path, monkeypatch):
    monkeypatch.setattr(run_bakeoff, "RESULTS", tmp_path)
    (tmp_path / "r1").mkdir()
    with pytest.raises(SystemExit, match="never overwritten"):
        run_bakeoff.output_dir("r1", None, private=False)


def test_prod_derived_runs_go_under_private(tmp_path, monkeypatch):
    monkeypatch.setattr(run_bakeoff, "RESULTS", tmp_path)
    assert run_bakeoff.output_dir("p1", None, private=True) == tmp_path / "private" / "p1"


def test_recorded_run_needs_a_tag():
    with pytest.raises(SystemExit, match="run-tag"):
        run_bakeoff.output_dir(None, None, private=False)


def test_isolated_arms_are_skipped_unless_running_as_the_bench_user():
    assert all(run_bakeoff.ARMS[a].isolated for a in ("ambernet", "whisper_probs", "mms_lid"))
    assert not run_bakeoff.ARMS["recognizer_competition"].isolated


def test_resume_reuses_an_existing_tag(tmp_path, monkeypatch):
    monkeypatch.setattr(run_bakeoff, "RESULTS", tmp_path)
    (tmp_path / "r1").mkdir()
    assert run_bakeoff.output_dir("r1", None, private=False, resume=True) == tmp_path / "r1"
