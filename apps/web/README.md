# apps/web — Chatofy Web

Next.js 15 App Router web client for Chatofy.

## Quick Start

```bash
# From monorepo root
pnpm --filter web dev
```

Open http://localhost:3001

## Scripts

| Command                       | Description                          |
| ----------------------------- | ------------------------------------ |
| `pnpm --filter web dev`       | Start dev server on port 3001        |
| `pnpm --filter web build`     | Production build                     |
| `pnpm --filter web start`     | Start production server on port 3001 |
| `pnpm --filter web lint`      | ESLint via next lint                 |
| `pnpm --filter web typecheck` | TypeScript check (no emit)           |

## Env

Copy `.env.example` to `.env.local` and fill in values:

```bash
cp apps/web/.env.example apps/web/.env.local
```

## Notes

- No Tailwind yet — add when UI implementation starts (YAGNI)
- No auth UI — deferred; will integrate with apps/api auth endpoints
- `src/clients/api-client.interface.ts` mirrors `apps/mobile` — keep in sync until stabilized into `@chatofy/sdk`
- Default to React Server Components; add `'use client'` only when needed
