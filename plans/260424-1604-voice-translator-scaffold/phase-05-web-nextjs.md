# Phase 5 — apps/web (Next.js)

**Priority:** P2 | **Status:** pending | **Depends:** Phase 2

## Overview

Minimal Next.js 15 App Router. Landing page placeholder. Scaffolded to grow into full web client later (extension + web app both likely reuse this).

## Structure

```
apps/web/
├── app/
│   ├── layout.tsx                     # root layout
│   ├── page.tsx                       # landing placeholder ("Chatofy — coming soon")
│   ├── globals.css
│   └── favicon.ico
├── public/
│   └── .gitkeep
├── src/
│   ├── config/
│   │   └── env.ts                     # validates NEXT_PUBLIC_* via zod
│   ├── clients/
│   │   └── api-client.interface.ts    # mirrors mobile — swap adapter per platform
│   └── lib/.gitkeep
├── next.config.mjs                    # transpilePackages for workspace pkgs
├── tsconfig.json                      # extends @chatofy/config/tsconfig/nextjs
├── eslint.config.mjs
├── postcss.config.mjs                 # (optional — defer tailwind until UI impl)
├── .env.example
└── package.json
```

## Key Config

- `next.config.mjs`:
  - `transpilePackages: ['@chatofy/types', '@chatofy/config']`
  - `experimental.typedRoutes: true`
  - strict mode on
- App Router, server components default

## Dependencies

- Runtime: `next@15`, `react@19`, `react-dom@19`, `zod`
- Workspace: `@chatofy/types`, `@chatofy/config`
- Dev: `typescript`, `eslint-config-next`

## Env (.env.example)

- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_ENV`

## Success Criteria

- `pnpm --filter web run dev` starts on port 3000
- Landing page renders
- `pnpm --filter web run build` succeeds
- Workspace package imports work (no transpile errors)

## Notes

- No Tailwind yet (YAGNI — add when UI impl starts)
- No i18n, no auth UI, no marketing content
- Browser extension NOT scaffolded this phase — deferred until MVP launch
