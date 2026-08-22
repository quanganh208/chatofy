# Local speech synthesis sidecar. Standalone uv project — the build context is
# this directory alone, not the repo root.
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim

# soundfile links libsndfile at runtime; the wheel does not carry it.
RUN apt-get update && \
    apt-get install -y --no-install-recommends libsndfile1 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a source edit does not re-resolve the lock.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Same missing-SONAME fix as the STT sidecar: the sherpa-onnx wheel expects an
# unversioned libonnxruntime.so next to its own bundled libraries, and the
# onnxruntime package ships only the versioned file. See services/local-stt/Dockerfile
# for the full reasoning.
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
# HF_HOME is a mount point. Creating it owned by the runtime user matters: Docker
# seeds a fresh named volume from the image's directory, ownership included, and
# a root-owned one makes the Vietnamese voice fail to download at startup.
RUN mkdir -p /hf-cache && chown app:app /hf-cache
USER app

ENV PATH="/app/.venv/bin:${PATH}"
EXPOSE 8003

# Fetches Kokoro (en). The Vietnamese voice is pulled from Hugging Face by the
# engine as it loads, into HF_HOME.
CMD ["sh", "-c", "python scripts/download_models.py && exec uvicorn app:app --host 0.0.0.0 --port 8003"]
