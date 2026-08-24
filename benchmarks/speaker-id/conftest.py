"""Put the bench root on sys.path for tests.

`pyproject.toml` sets `package = false`, so `uv sync` installs dependencies
without installing `speaker_bench` itself. pytest inserts the directory of the
first non-package parent of a test file — `tests/` — which is not enough to
import `speaker_bench`. A conftest at the bench root gets that directory
inserted too, which is all this file is for.
"""
