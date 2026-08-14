"""Loads the SERVICE's parakeet binding, rather than keeping a copy here.

This harness is a standalone `uv` project and cannot import `services/local-stt`
as a package, but copying the ctypes binding in would mean benchmarking code
that nobody runs in production — and the binding is exactly where a wrong
argtype or a leaked pointer would change the numbers. So it is loaded from the
service directory by path.

Override the location with `LOCAL_STT_SERVICE_DIR` when running against a
checkout laid out differently.
"""

import importlib.util
import os
import sys
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SERVICE_DIR = BENCH_ROOT.parent.parent / "services" / "local-stt"


def _service_dir() -> Path:
    raw = os.environ.get("LOCAL_STT_SERVICE_DIR")
    return Path(raw) if raw else DEFAULT_SERVICE_DIR


def _load():
    source = _service_dir() / "engines" / "parakeet_runtime.py"
    if not source.exists():
        raise RuntimeError(
            f"service binding not found at {source}; set LOCAL_STT_SERVICE_DIR"
        )
    spec = importlib.util.spec_from_file_location("parakeet_runtime", source)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {source}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["parakeet_runtime"] = module
    spec.loader.exec_module(module)
    return module


_module = _load()
ParakeetModel = _module.ParakeetModel
strip_language_tags = _module.strip_language_tags
