# Chatofy — Voice Translator Monorepo

Real-time voice translation app. Turborepo + pnpm workspace.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start all dev servers
pnpm dev

# Or start individual apps
pnpm --filter @chatofy/api dev
pnpm --filter @chatofy/mobile dev
pnpm --filter @chatofy/web dev
```

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

- Node >= 20 (use `.nvmrc`: `nvm use`)
- pnpm >= 9 (`corepack enable && corepack use pnpm@9`)

## Docs

See [`docs/`](./docs/) for architecture, code standards, and deployment guides.
See [`plans/`](./plans/) for implementation plans and progress tracking.
