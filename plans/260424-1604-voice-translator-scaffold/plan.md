---
name: voice-translator-scaffold
date: 2026-04-24
status: completed
mode: bootstrap
---

# Voice Translator — Monorepo Scaffold

Init Turborepo + pnpm monorepo with 3 apps (api, mobile, web) and 4 packages (config, types, ai-providers, ui). Interface-first for swap-ability. No feature impl in this scaffold.

## Scope

- Structure only — no business logic, no UI features
- All provider/external integrations behind interfaces
- Shared code extracted to packages from day 1
- Dev infra: Docker (Postgres/Redis), Turborepo pipelines, Husky + commitlint, CI skeleton

## Phases

| #   | Phase                  | Status    | File                                                               |
| --- | ---------------------- | --------- | ------------------------------------------------------------------ |
| 1   | Monorepo foundation    | completed | [phase-01-monorepo-foundation.md](phase-01-monorepo-foundation.md) |
| 2   | Shared packages        | completed | [phase-02-shared-packages.md](phase-02-shared-packages.md)         |
| 3   | apps/api (NestJS)      | completed | [phase-03-api-nestjs.md](phase-03-api-nestjs.md)                   |
| 4   | apps/mobile (Expo)     | completed | [phase-04-mobile-expo.md](phase-04-mobile-expo.md)                 |
| 5   | apps/web (Next.js)     | completed | [phase-05-web-nextjs.md](phase-05-web-nextjs.md)                   |
| 6   | Dev infra (Docker, CI) | completed | [phase-06-dev-infra.md](phase-06-dev-infra.md)                     |

## Dependencies

- Phase 1 blocks all others (defines workspace)
- Phase 2 blocks Phase 3/4/5 (apps consume packages)
- Phase 3/4/5 can run in parallel after Phase 2
- Phase 6 can run in parallel with 3/4/5

## Success Criteria

- `pnpm install` succeeds at root
- `pnpm turbo run build` succeeds (all apps type-check)
- Each app starts in dev mode without errors
- Interfaces defined in packages are consumable from apps (type-checked imports)
- `docker-compose up` brings up Postgres + Redis
- No secrets committed; `.env.example` in each app

## Out of Scope

- Feature implementation (auth flows, audio streaming logic, AI provider impl)
- UI design beyond empty screens
- Tests (add during feature impl)
- Deployment configs (Fly.io/EAS) beyond Dockerfile

## Reports

- [brainstorm-260424-1604-voice-translator-init.md](../reports/brainstorm-260424-1604-voice-translator-init.md)
