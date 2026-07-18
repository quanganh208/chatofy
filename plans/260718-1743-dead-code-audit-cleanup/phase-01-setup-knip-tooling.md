---
phase: 1
title: Setup knip tooling
status: completed
effort: S
priority: P2
dependencies: []
---

# Phase 1: Setup knip tooling

## Overview

Install knip at root, author `knip.json` covering all 7 workspaces with correct entry points and intentional-stub ignores, add `pnpm knip` script.

## Requirements

- Functional: `pnpm knip` runs across the whole workspace without crashing; plugins auto-detected for Next.js/Expo where applicable.
- Non-functional: config committed and self-documenting; ignores minimal and each traceable to a locked user decision.

## Architecture

knip workspace config (root `knip.json`), per-workspace entries:

- `apps/api` — entry `src/main.ts` (NestJS; no official plugin — DI false-positives expected, handled in Phase 2)
- `apps/web` — Next.js plugin (auto: `app/**` conventions)
- `apps/mobile` — Expo plugin (auto: expo-router `app/**` routes)
- `packages/{types,api-client,ai-providers}` — library mode, entry `src/index.ts` (exports are public API — enable `includeEntryExports` only if useful; do NOT flag index re-exports consumed cross-workspace)
- `packages/config` — shared preset files as entries (eslint/tsconfig presets referenced by name, not import)
- `packages/ui` — ignored workspace (intentional stub)

Ignores (locked decision #3): `packages/ui/**`, `**/realtime-provider.ts`, mobile `src/audio/*.interface.ts`, mobile `ws-client*`, `Noop*` classes, `PrismaUserRepository` (verify each is actually flagged before adding ignore — don't pre-ignore things knip doesn't report).

## Related Code Files

- Modify: `package.json` (root — add `knip` devDep + `"knip": "knip"` script)
- Create: `knip.json`
- Modify: `pnpm-lock.yaml` (via install)

## Implementation Steps

1. `pnpm add -D -w knip`
2. Author `knip.json` with workspace entries above; start WITHOUT ignores.
3. Run `pnpm knip` — fix config-level errors (wrong entries, missing plugin detection) until output is real findings, not config noise. Route/layout files flagged in `apps/web` or `apps/mobile` = config bug, fix entry globs, not code.
4. Add ignore entries ONLY for intentional stubs that knip actually reports.

## Success Criteria

- [ ] `pnpm knip` runs clean of config errors and produces a findings list
- [ ] No Next.js/Expo convention files (routes, layouts) appear as findings
- [ ] Each ignore entry maps to a documented intentional stub

## Risk Assessment

- Expo SDK 52 plugin detection may miss custom entry — mitigate by explicit `entry` globs for `apps/mobile/app/**`.
- knip version churn — pin exact version in devDependencies.
