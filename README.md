# Chatofy — Voice Translator Monorepo

Real-time voice translation app. Turborepo + pnpm workspace.

## Quick Start

```bash
# Install dependencies (also generates the Prisma client via api postinstall)
pnpm install

# Configure the API environment — required for the api to boot
cp apps/api/.env.example apps/api/.env
# then edit apps/api/.env and point DATABASE_URL at a running Postgres

# Start all dev servers
pnpm dev

# Or start individual apps
pnpm --filter @chatofy/api dev
pnpm --filter @chatofy/mobile dev
pnpm --filter @chatofy/web dev
```

> The `api` validates its environment on boot and needs a reachable
> PostgreSQL (`DATABASE_URL`). `web` runs without any env setup.

## Structure

```
chatofy/
├── apps/
│   ├── api/        # NestJS REST + WebSocket API
│   ├── mobile/     # Expo React Native app
│   └── web/        # Next.js web app
├── packages/
│   ├── ui/         # Shared UI components
│   ├── config/     # Shared config (ESLint, TS, etc.)
│   └── types/      # Shared TypeScript types
├── docs/           # Project documentation
└── plans/          # Implementation plans
```

## Commands

| Command          | Description                    |
| ---------------- | ------------------------------ |
| `pnpm dev`       | Start all apps in dev mode     |
| `pnpm build`     | Build all packages and apps    |
| `pnpm lint`      | Lint all workspaces            |
| `pnpm typecheck` | Type-check all workspaces      |
| `pnpm format`    | Format all files with Prettier |
| `pnpm clean`     | Remove all build artifacts     |

## Requirements

- Node >= 22 (`.nvmrc` pins 24; run `nvm use`)
- pnpm 11 via Corepack (`corepack enable` — version pinned by `packageManager`)
- PostgreSQL for the `api` (set `DATABASE_URL` in `apps/api/.env`)

## Docs

See [`docs/`](./docs/) for architecture, code standards, and deployment guides.
See [`plans/`](./plans/) for implementation plans and progress tracking.
