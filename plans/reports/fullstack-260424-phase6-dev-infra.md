# Phase 6 Dev Infra — Implementation Report

**Date:** 2026-04-24
**Phase:** phase-06-dev-infra
**Status:** DONE

## Files Created

| File                               | Lines | Notes                                                                  |
| ---------------------------------- | ----- | ---------------------------------------------------------------------- |
| `docker-compose.yml`               | 42    | postgres:16-alpine + redis:7-alpine, healthchecks, named volumes       |
| `docker/postgres/init.sql`         | 6     | uuid-ossp + pgcrypto extensions only                                   |
| `.github/workflows/ci.yml`         | 72    | lint + typecheck + build jobs; concurrency cancel; pnpm 9 / node 20    |
| `.github/workflows/README.md`      | 19    | Expansion notes (EAS, Fly.io, Vercel, Turborepo cache)                 |
| `.github/PULL_REQUEST_TEMPLATE.md` | 18    | Summary / Changes / Test plan / Checklist                              |
| `.github/dependabot.yml`           | 88    | 8 directories; weekly Monday; non-major groups; React/RN major ignored |
| `.vscode/settings.json`            | 28    | TS SDK, formatOnSave, ESLint, files.exclude                            |
| `.vscode/extensions.json`          | 14    | Prettier, ESLint, Prisma, Expo, Tailwind, GitLens, Jest                |
| `.vscode/launch.json`              | 44    | NestJS ts-node, Next.js terminal, Expo Hermes attach                   |

## Modified Files

| File           | Change                                                               |
| -------------- | -------------------------------------------------------------------- |
| `.env.example` | Appended Docker Compose block: POSTGRES\_\*, DATABASE_URL, REDIS_URL |

## Deviations

- CI uses 3 separate jobs (lint/typecheck/build) instead of a single `setup` job that others depend on. GitHub Actions doesn't support a true "setup" job sharing installed deps across jobs without artifact upload. The chosen pattern (each job installs its own deps with pnpm cache) is idiomatic and correct.
- `continue-on-error: false` on lint job — workspaces without a `lint` script will fail the job. If parallel phases didn't add lint scripts to all packages, this may need to be changed to `true` or filtered. Left strict for now.

## Unresolved Questions

1. Do all apps (api/mobile/web) define a `lint` script in their package.json? If any workspace omits it, `pnpm -r run lint` will fail in CI.
2. Turbo remote cache: `TURBO_TOKEN` / `TURBO_TEAM` secrets not configured — builds will be slow on CI until added.
3. `.env.example` append assumed `POSTGRES_PASSWORD` was absent — confirmed before edit.
