---
title: Shared types consolidation + repo-wide interface refactor
description: >-
  Eliminate type duplication/drift across api-web-mobile, standardize interface
  naming, split oversized web translate page. From approved brainstorm scope C.
status: completed
priority: P2
branch: main
tags:
  - refactor
  - types
  - monorepo
blockedBy: []
blocks: []
created: '2026-07-18T09:18:42.901Z'
createdBy: 'ck:plan'
source: skill
---

# Shared types consolidation + repo-wide interface refactor

## Overview

Brainstorm verdict (report: [`../reports/brainstorm-260718-1611-shared-types-oop-refactor-report.md`](../reports/brainstorm-260718-1611-shared-types-oop-refactor-report.md)): architecture already sound (`@chatofy/types` zod schema-first, `@chatofy/ai-providers` interface+registry, NestJS DI tokens). Real problem = localized contract drift:

- `AuthSession` name collision with divergent shape (mobile local vs shared)
- Local re-declarations (`Direction` in web page, `HealthResponse` inline in controller)
- WS gateway payload types diverge from shared `ClientEventSchema`
- `VIENEU_VOICES` hardcoded in web page
- Mobile `I`-prefix interfaces vs no-prefix elsewhere
- `apps/web/app/translate/page.tsx` 287 LOC (repo cap 200)

**Explicit non-goals** (user-visible decisions, do not "fix"): keep `UserRecord`/`SessionRecord` persistence types separate from domain `User`/`ConversationSession` (intentional layer separation, mapper exists); no OOP/class conversion of React components; no new abstractions on NestJS side.

## Phases

| Phase | Name                                                                               | Status    |
| ----- | ---------------------------------------------------------------------------------- | --------- |
| 1     | [Consolidate shared types](./phase-01-consolidate-shared-types.md)                 | Completed |
| 2     | [Interface naming standardization](./phase-02-interface-naming-standardization.md) | Completed |
| 3     | [Modularize web translate page](./phase-03-modularize-web-translate-page.md)       | Completed |
| 4     | [Boundary audit and verification](./phase-04-boundary-audit-and-verification.md)   | Completed |

Phase order: 1 → 2 → 3 → 4. Phases 2 and 3 are independent of each other but both depend on 1 (shared imports land first). Phase 4 gates completion.

## Acceptance Criteria

- Zero local re-declarations of types that exist in `@chatofy/types` (documented persistence keeps excluded)
- Single interface naming convention (no `I`-prefix anywhere)
- `apps/web/app/translate/page.tsx` < 100 LOC, translate flow behavior unchanged
- `pnpm typecheck && pnpm lint && pnpm build` green across workspace

## Verification Gates

Primary: `pnpm typecheck`, `pnpm lint`, `pnpm build` (full workspace). Local jest known-fragile (hoisted-linker dual-jest; CI runs no jest) — run api specs only if runner healthy, do not block on it.

## Dependencies

None. `plans/260718-1457-local-cpu-stt-tts-hybrid-benchmark/` is an empty leftover dir, no overlap.
