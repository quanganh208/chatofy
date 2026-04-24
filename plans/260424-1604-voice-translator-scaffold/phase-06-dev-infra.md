# Phase 6 — Dev Infrastructure

**Priority:** P1 | **Status:** pending | **Depends:** Phase 1

## Overview

Local dev services + CI skeleton. Can run parallel with Phases 3-5.

## Files

### Docker Compose (local dev services)

- `docker-compose.yml`:
  - `postgres:16` — port 5432, volume, healthcheck
  - `redis:7` — port 6379, volume, healthcheck
  - `.env` reference for credentials
- `docker/postgres/init.sql` — create dev database

### GitHub Actions CI (skeleton, not enabled for prod)

- `.github/workflows/ci.yml`:
  - triggers: PR + push to main
  - jobs: `setup` (checkout, pnpm, cache) → `lint`, `typecheck`, `build` (matrix per workspace)
  - node 20, pnpm 9
- `.github/workflows/README.md` — notes on expanding CI (tests, deploy) later
- `.github/PULL_REQUEST_TEMPLATE.md` — minimal template
- `.github/dependabot.yml` — weekly updates for root + each app/package

### Editor / DX

- `.vscode/settings.json` — TS SDK pointing to workspace, format on save, ESLint
- `.vscode/extensions.json` — recommend Prettier, ESLint, Prisma, Expo, Nest
- `.vscode/launch.json` — debug configs for NestJS + Next.js

### Root env

- `.env.example` (root) — aggregate of required envs referenced from docker-compose

## Success Criteria

- `docker compose up -d` brings up postgres + redis; healthchecks pass
- `docker compose down -v` cleans volumes
- CI workflow syntactically valid (`gh workflow view ci.yml --repo local` or similar lint)
- VSCode opens workspace with no errors

## Out of Scope

- Production deploy pipelines (Fly.io/Railway/Vercel/EAS) — add when going live
- Monitoring/observability (Sentry, OpenTelemetry) — post-MVP
