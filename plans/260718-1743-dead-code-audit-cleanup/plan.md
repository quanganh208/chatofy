---
title: Dead-code audit and cleanup (knip)
description: >-
  Install knip, audit all 7 TS workspaces for unused files/exports/deps,
  one-shot ruff pass on Python sidecar, delete confirmed dead code, sync docs.
status: completed
priority: P2
branch: main
tags:
  - cleanup
  - dead-code
  - tooling
  - monorepo
blockedBy: []
blocks: []
created: '2026-07-18T10:50:33.081Z'
createdBy: 'ck:plan'
source: skill
---

# Dead-code audit and cleanup (knip)

## Overview

From approved brainstorm (report: [`../reports/brainstorm-260718-1743-dead-code-audit-cleanup-report.md`](../reports/brainstorm-260718-1743-dead-code-audit-cleanup-report.md)). Goal: find + delete unused files, exports, and dependencies across the monorepo (~146 TS files, 7 workspaces) and the 2-file Python sidecar, then fix docs drift.

**User decisions (locked):**

1. Audit + delete in same effort (not report-only).
2. Scope = TS files/exports + deps + Python sidecar + docs drift.
3. Keep ALL intentional interface-first stubs — mark as knip ignores: `packages/ui`, `RealtimeProvider`, `IAudioRecorder`/`IAudioPlayer`, `Noop*` providers, `PrismaUserRepository`, mobile scaffold (`ws-client`, audio interfaces — locked in plan 260718-1645).
4. knip installed as root devDependency + committed `knip.json` (repeatable, CI-ready later; CI gate itself is out of scope).

**Verification gate** (matches CI; api jest fragile — not a gate): `pnpm lint && pnpm typecheck && pnpm build`, plus re-run `pnpm knip` → 0 findings beyond declared ignores.

**Key risk:** NestJS DI / `ProviderRegistry` resolution makes knip false-positives likely in `apps/api` and `packages/ai-providers`. Every deletion requires manual grep verification first.

## Phases

| Phase | Name                                                       | Status    |
| ----- | ---------------------------------------------------------- | --------- |
| 1     | [Setup knip tooling](./phase-01-setup-knip-tooling.md)     | Completed |
| 2     | [Audit TS workspaces](./phase-02-audit-ts-workspaces.md)   | Completed |
| 3     | [Audit Python sidecar](./phase-03-audit-python-sidecar.md) | Completed |
| 4     | [Cleanup and verify](./phase-04-cleanup-and-verify.md)     | Completed |
| 5     | [Docs sync](./phase-05-docs-sync.md)                       | Completed |

## Dependencies

None. Prior plans `260718-1611` and `260718-1645` are completed; no blocking relationships. Phase order: 1 → 2 → (3 parallel-safe) → 4 → 5.

## Acceptance Criteria

- [ ] `pnpm knip` exits 0 with documented ignores only
- [ ] Confirmed dead files/exports/deps deleted (incl. verdict on `ioredis`)
- [ ] `pnpm lint && pnpm typecheck && pnpm build` green
- [ ] No behavior change; intentional stubs untouched
- [ ] README structure + `docs/codebase-summary.md` match reality
