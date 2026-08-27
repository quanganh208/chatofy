# Local speech-to-text sidecar. Standalone uv project — the build context is
# this directory alone, not the repo root.
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim

WORKDIR /app

# Same 30s-per-download ceiling that failed the TTS sidecar's build, and the
# wheels here are no smaller — onnxruntime and sherpa-onnx both ship bundled
# native libraries. See services/local-tts/Dockerfile.
ENV UV_HTTP_TIMEOUT=300

# Dependencies first, so a source edit does not re-resolve the lock.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# The sherpa-onnx Linux wheel bundles libasound but NOT libonnxruntime.so, while
# _sherpa_onnx.so has RPATH $ORIGIN/../../sherpa_onnx.libs. The onnxruntime
# package it depends on ships only the versioned libonnxruntime.so.<ver>, so the
# unversioned SONAME the loader asks for resolves nowhere and `import sherpa_onnx`
# dies with an ImportError before any of our code runs.
#
# Linking the two together is the whole fix. It lives here rather than in a
# setup step because a venv rebuild silently undoes it, and a broken import is
# not something a developer should have to rediscover each time.
RUN uv run --no-sync python - <<'PY'
import pathlib, onnxruntime

capi = pathlib.Path(onnxruntime.__file__).parent / "capi"
site_packages = pathlib.Path(onnxruntime.__file__).parent.parent
dst = site_packages / "sherpa_onnx.libs" / "libonnxruntime.so"
if not dst.exists():
    dst.symlink_to(next(capi.glob("libonnxruntime.so.*")))
PY

COPY . .

# Run as the host's own uid so weights the download step writes into the
# bind-mounted models/ are not left root-owned in the working tree.
ARG UID=1000
ARG GID=1000
RUN groupadd -g "${GID}" -o app && useradd -u "${UID}" -g "${GID}" -o -m app && \
    chown -R app:app /app
USER app

ENV PATH="/app/.venv/bin:${PATH}"
EXPOSE 8002

# download_models.py is idempotent and returns immediately once the weights are
# present, so a fresh clone needs no separate setup command.
CMD ["sh", "-c", "python scripts/download_models.py && exec uvicorn app:app --host 0.0.0.0 --port 8002"]
