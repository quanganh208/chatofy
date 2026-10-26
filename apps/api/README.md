# api

NestJS REST + WebSocket API for Chatofy: auth, the `/ws/translate` translation turn, conference rooms and `/ws/conference` signaling, history, minutes, AI Context.

## Quick start

Run from the monorepo root.

```bash
# The env file; src/config/env.schema.ts is the authority for every key
cp apps/api/.env.example apps/api/.env
# Set AUTH_JWT_SECRET (the api refuses to start without it):
#   openssl rand -base64 32
# Set CLOUDFLARE_REALTIME_APP_ID and CLOUDFLARE_REALTIME_APP_SECRET as well:
# meetings always load and the api refuses to boot without them.

docker compose up -d --wait postgres redis
pnpm --filter api exec prisma migrate deploy
pnpm --filter api dev
```

## Tests

- `pnpm --filter api test` — unit tests (Vitest)
- `pnpm --filter api test:cov` — unit tests with a coverage report
- `pnpm --filter api test:e2e` — end-to-end suite (needs Redis)
- `pnpm --filter api test:e2e:db` — end-to-end suite against Postgres
- `pnpm --filter api typecheck` — type check
- `pnpm --filter api lint` — ESLint

## Docs

Architecture: [system-architecture.md](../../docs/system-architecture.md).
