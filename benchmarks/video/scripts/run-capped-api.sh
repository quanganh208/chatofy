#!/usr/bin/env bash
# run-capped-api.sh
#
# Start the NestJS API inside a Docker container with a ~3.4 GiB memory cap,
# mirroring the production VM's headroom. The mediasoup worker runs inside
# the container; the benchmark harness (Playwright) runs on the host and
# connects via localhost.
#
# Usage:
#   bash scripts/run-capped-api.sh           # start capped API
#   bash scripts/run-capped-api.sh --stop    # stop and remove the container
#
# Prerequisites:
#   - Docker installed and running
#   - Project built: pnpm build (or pnpm --filter api build)
#   - .env file at project root (or set env vars below)
#
# Environment variables (override defaults):
#   MEMORY_LIMIT      Docker memory limit (default: 3584m ≈ 3.4 GiB)
#   API_PORT          Host port for the API (default: 3000)
#   PROJECT_ROOT      Absolute path to the chatofy repo root (default: auto-detect)
#   CONTAINER_NAME    Docker container name (default: chatofy-api-bench)

set -euo pipefail

MEMORY_LIMIT="${MEMORY_LIMIT:-3584m}"
API_PORT="${API_PORT:-3000}"
CONTAINER_NAME="${CONTAINER_NAME:-chatofy-api-bench}"

# Auto-detect project root (two levels up from this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"

if [[ "${1:-}" == "--stop" ]]; then
  echo "Stopping $CONTAINER_NAME…"
  docker stop "$CONTAINER_NAME" 2>/dev/null || true
  docker rm   "$CONTAINER_NAME" 2>/dev/null || true
  echo "Done."
  exit 0
fi

# ── Verify memory limit ──────────────────────────────────────────────────────
echo "Starting capped API container:"
echo "  Image source: ${PROJECT_ROOT}/apps/api"
echo "  Memory cap:   ${MEMORY_LIMIT}"
echo "  Host port:    ${API_PORT}"
echo "  Container:    ${CONTAINER_NAME}"

# ── Build the API image if it doesn't exist ──────────────────────────────────
IMAGE_TAG="chatofy-api:bench"
if ! docker image inspect "$IMAGE_TAG" &>/dev/null; then
  echo "Building Docker image $IMAGE_TAG…"
  docker build \
    -t "$IMAGE_TAG" \
    -f "${PROJECT_ROOT}/apps/api/Dockerfile" \
    "${PROJECT_ROOT}"
fi

# ── Remove any stale container ────────────────────────────────────────────────
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

# ── Start container ───────────────────────────────────────────────────────────
docker run \
  --name "$CONTAINER_NAME" \
  --memory "$MEMORY_LIMIT" \
  --memory-swap "$MEMORY_LIMIT" \
  -p "${API_PORT}:3000" \
  -e NODE_ENV=development \
  -e CONFERENCE_ENABLED=true \
  -e CONFERENCE_METRICS_ENABLED=1 \
  -e MEDIASOUP_ANNOUNCED_IP=127.0.0.1 \
  --env-file "${PROJECT_ROOT}/.env" \
  -d \
  "$IMAGE_TAG"

echo ""
echo "Container started: $(docker inspect --format='{{.State.Pid}}' "$CONTAINER_NAME")"
echo "Memory limit:      $(docker inspect --format='{{.HostConfig.Memory}}' "$CONTAINER_NAME") bytes"
echo ""
echo "Wait 5s for the API to boot, then verify:"
echo "  curl http://localhost:${API_PORT}/health"
echo "  curl http://localhost:${API_PORT}/conference/metrics"
echo ""
echo "To stop:"
echo "  bash scripts/run-capped-api.sh --stop"
echo ""
echo "API PID inside container (for pidusage):"
docker inspect --format='{{.State.Pid}}' "$CONTAINER_NAME"
