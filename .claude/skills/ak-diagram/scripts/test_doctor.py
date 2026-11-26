"""Browser-cache discovery in doctor.py must work off Linux containers too."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location("ak_diagram_doctor", Path(__file__).with_name("doctor.py"))
doctor = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(doctor)


def test_env_override_wins(monkeypatch, tmp_path):
    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(tmp_path))
    assert doctor._browser_roots() == [tmp_path]


def test_win32_uses_localappdata_cache(monkeypatch, tmp_path):
    monkeypatch.delenv("PLAYWRIGHT_BROWSERS_PATH", raising=False)
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    assert doctor._browser_roots()[0] == tmp_path / "ms-playwright"


def test_darwin_uses_library_caches(monkeypatch, tmp_path):
    monkeypatch.delenv("PLAYWRIGHT_BROWSERS_PATH", raising=False)
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    assert doctor._browser_roots()[0] == tmp_path / "Library" / "Caches" / "ms-playwright"


@pytest.mark.parametrize("name", ["chromium-1243", "chromium_headless_shell-1248"])
def test_probe_finds_any_installed_chromium_revision(monkeypatch, tmp_path, name):
    (tmp_path / name).mkdir()
    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(tmp_path))
    ok, message = doctor._probe_chromium()
    assert ok, message
    assert name in message


def test_probe_reports_searched_roots_when_missing(monkeypatch, tmp_path):
    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(tmp_path))
    ok, message = doctor._probe_chromium()
    assert not ok
    assert str(tmp_path) in message


def test_browsers_path_zero_means_package_local(monkeypatch):
    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", "0")
    ok, message = doctor._probe_chromium()
    assert ok, message
