"""Repair the sherpa-onnx / onnxruntime SONAME gap in this bench's venv.

`import sherpa_onnx` fails with
``ImportError: libonnxruntime.so: cannot open shared object file`` on a fresh
venv. The sherpa-onnx Linux wheel bundles `libasound-*.so` into
`site-packages/sherpa_onnx.libs/` but omits `libonnxruntime.so`, while
`_sherpa_onnx.so`'s RPATH points at that directory. The `onnxruntime` wheel it
depends on ships only the VERSIONED `onnxruntime/capi/libonnxruntime.so.1.27.0`,
so the unversioned SONAME the loader asks for is never resolvable.

The same gap affects `services/local-stt` and `services/local-tts`; it is not
fixed in-repo, and it comes back whenever a venv is rebuilt. This script is the
bench's own copy of the one-line repair so a fresh `uv sync` here is followed by
one obvious command rather than a confusing ImportError.

Idempotent. Run:
    uv run python scripts/link_onnxruntime.py
"""

from __future__ import annotations

import sys
from pathlib import Path


def site_packages() -> Path:
    """The venv's site-packages, found from the running interpreter."""
    for entry in sys.path:
        candidate = Path(entry)
        if candidate.name == "site-packages" and candidate.is_dir():
            return candidate
    raise RuntimeError("could not locate site-packages; run this through `uv run`")


def main() -> int:
    packages = site_packages()
    libs_dir = packages / "sherpa_onnx.libs"
    link = libs_dir / "libonnxruntime.so"

    if not libs_dir.is_dir():
        print(f"no {libs_dir} — is sherpa-onnx installed? run `uv sync`", file=sys.stderr)
        return 1

    if link.exists():
        print(f"ok    {link} already resolves")
        return 0

    capi = packages / "onnxruntime" / "capi"
    versioned = sorted(capi.glob("libonnxruntime.so.*"))
    if not versioned:
        print(f"no versioned libonnxruntime under {capi}", file=sys.stderr)
        return 1
    if len(versioned) > 1:
        # Ambiguity here would silently bind the extension to the wrong ABI,
        # and the pins in pyproject.toml exist precisely to keep it to one.
        print(f"expected exactly one, found: {[p.name for p in versioned]}", file=sys.stderr)
        return 1

    # Symlink rather than copy: a copy would go stale the next time onnxruntime
    # is upgraded and bind the extension to an ABI nothing else is using.
    link.symlink_to(versioned[0])
    print(f"link  {link} -> {versioned[0]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
