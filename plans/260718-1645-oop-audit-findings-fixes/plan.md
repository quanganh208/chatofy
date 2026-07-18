---
title: OOP/SOLID audit findings fixes (TDD)
description: >-
  Fix all findings from 260718 OOP/SOLID audit: provider contracts, registry
  wiring, typed transport errors, React robustness
status: completed
priority: P2
branch: main
tags:
  - refactor
  - oop
  - solid
  - tdd
  - monorepo
blockedBy: []
blocks: []
created: '2026-07-18T09:53:20.007Z'
createdBy: 'ck:plan'
source: skill
---

# OOP/SOLID audit findings fixes (TDD)

## Overview

Fix ~20 findings from OOP/SOLID audit (report: [`plans/reports/brainstorm-260718-1645-oop-solid-audit-report.md`](../reports/brainstorm-260718-1645-oop-solid-audit-report.md)). Verdict was PASS; these are polish fixes strengthening the SOLID story before graduation defense. 0 critical, 1 medium (api-client transport errors), rest minor.

**User decisions (locked):**

1. Wire `ProviderRegistry` into app factory (completes OCP end-to-end).
2. `LanguageCode` via type-only import from `@chatofy/types` (drop redeclaration, keep ai-providers zod-free at runtime).
3. Keep mobile scaffold (ws-client, audio interfaces), fix WS lifecycle, document as planned-for-conversation.

**TDD approach:** each phase locks current behavior with tests before changing. Test harness reality: only `apps/api` has jest (provider specs already live there — extend that pattern for packages/ai-providers changes). Phase 3 adds vitest to `packages/api-client` (new harness, deliberate). Phase 4 (React apps, no harness) uses typecheck + lint + documented manual verification; adding RTL is out of scope.

## Phases

| Phase | Name                                                                                           | Status    |
| ----- | ---------------------------------------------------------------------------------------------- | --------- |
| 1     | [Provider contracts and error hierarchy](./phase-01-provider-contracts-and-error-hierarchy.md) | Completed |
| 2     | [API fixes and registry wiring](./phase-02-api-fixes-and-registry-wiring.md)                   | Completed |
| 3     | [API-client typed transport errors](./phase-03-api-client-typed-transport-errors.md)           | Completed |
| 4     | [Web and mobile robustness](./phase-04-web-and-mobile-robustness.md)                           | Completed |

## Dependencies

- Phase 2 depends on Phase 1 (consumes `outputMimeType`, new error base, typed registry).
- Phase 3 independent of 1-2 (separate package); can run parallel after 1.
- Phase 4 independent (React apps only); can run parallel any time.
- No cross-plan deps: `260718-1611-shared-types-oop-refactor` is done (4/4).

## Acceptance Criteria

- All audit findings resolved or explicitly deferred with rationale.
- `pnpm typecheck`, `pnpm lint`, `pnpm --filter @chatofy/api test` green.
- New api-client vitest suite green.
- No public contract breaks except additive ones (new error classes, `outputMimeType` on `TtsProvider`).
- Adding a hypothetical 4th provider requires zero edits to pipeline/factory consumers (OCP proof).

## Risks

- **Jest hoist fragility** (memory 260718): pnpm hoisted-linker dual-jest can flip api jest working↔broken per install. Adding vitest to api-client changes install graph — after `pnpm install`, immediately verify `pnpm --filter @chatofy/api test` still runs before proceeding.
- `outputMimeType` on `TtsProvider` is an interface addition — all impls (elevenlabs, vieneu) must implement it in the same commit or typecheck breaks.
- Registry wiring changes provider construction path — existing factory specs lock behavior first (cache key semantics must survive).
