---
phase: 3
title: API-client typed transport errors
status: completed
priority: P2
dependencies:
  - 1
---

# Phase 3: API-client typed transport errors

## Overview

Fix the audit's single medium finding: `packages/api-client` transport failures (network `TypeError`, timeout `AbortError`) escape the typed `ApiClientError`/`ContractError` hierarchy, and the abort timer only guards fetch, not body reads. Add `NetworkError` + timeout coverage for body reads. Adds a vitest harness to this package (first tests here — deliberate, package is pure logic and ideal for unit tests).

## Requirements

- Functional: all failure paths from `apiFetch` throw exactly one of `ApiClientError | ContractError | NetworkError`; timeout covers fetch **and** body read; timeout distinguishable (e.g. `NetworkError.timedOut: true` or `cause` preserved).
- Non-functional: no new runtime deps; RN-safe (no DOM-only types in public surface — existing constraint at `api-client.ts:5-8`); web + mobile keep compiling without changes (additive error class).

## Architecture

- `errors.ts`: add `NetworkError extends Error` — `public readonly timedOut: boolean`, `cause` preserved, `name` set. Export from `index.ts`.
- `api-client.ts`: wrap fetch call — catch `AbortError` → `NetworkError(timedOut: true)`, other fetch throws → `NetworkError(timedOut: false, cause)`. Move `clearTimeout` after body read (`res.json()`), pass abort signal awareness to body read path (json read after abort → timeout NetworkError).
- Consumers (web `use-translate-turn.ts`, mobile clients): no required change (additive); optional message branch for `NetworkError` deferred to Phase 4 web fix if trivial.

## Related Code Files

- Modify: `packages/api-client/src/errors.ts`, `packages/api-client/src/index.ts`, `packages/api-client/src/api-client.ts`.
- Create: `packages/api-client/src/api-client.spec.ts` (vitest, mock `globalThis.fetch`).
- Modify: `packages/api-client/package.json` (vitest devDep + `"test": "vitest run"`), `turbo.json` if test task wiring needed.

## Implementation Steps (TDD)

1. Add vitest devDep + script. **Immediately run `pnpm --filter @chatofy/api test`** — guard against jest hoist flip (see plan risks); if broken, stop and fix install graph before continuing.
2. **Tests first** (red): mocked-fetch spec —
   - success envelope parse (locks current behavior),
   - API error envelope → `ApiClientError`,
   - contract drift → `ContractError`,
   - fetch rejects `TypeError` → `NetworkError` (`timedOut: false`, cause preserved),
   - abort during fetch → `NetworkError` (`timedOut: true`),
   - slow body read past timeout → `NetworkError` (currently raw AbortError/hang — this is the behavior change),
   - 502 HTML (json null, !ok) still → `ApiClientError` status-first (regression lock).
3. Implement `NetworkError` + fetch wrap + body-read timeout coverage.
4. Green suite; `pnpm typecheck && pnpm lint && pnpm build`; compile-check web + mobile (`pnpm --filter @chatofy/web typecheck`, `--filter @chatofy/mobile typecheck`).

## Success Criteria

- [x] Every `apiFetch` failure path throws typed error (spec enumerates all branches)
- [x] Timeout fires on slow body read, not just slow fetch
- [x] `pnpm --filter @chatofy/api-client test` green; api jest still green post-install
- [x] Web + mobile typecheck unchanged-green (additive contract confirmed)

## Risk Assessment

- **Install-graph risk is the big one**: adding vitest can flip the api dual-jest hoist issue (memory 260718). Mitigation baked into step 1.
- Moving `clearTimeout` after body read lengthens abort window semantics — spec fixes intended behavior explicitly.
- Rollback: single commit; removing vitest devDep restores prior install graph.
