---
phase: 4
title: Boundary audit and verification
status: completed
effort: 0.25d
priority: P1
dependencies:
  - 1
  - 2
  - 3
---

# Phase 4: Boundary audit and verification

## Overview

Final sweep for remaining type drift + full-workspace verification gates. Closes the plan.

## Requirements

- Functional: no code change unless the sweep finds a missed duplication
- Non-functional: documented rationale for every intentional local type kept

## Related Code Files

- Read/audit: all `apps/**/*.{ts,tsx}` type/interface declarations vs `packages/types/src`
- Possibly modify: any stragglers found

## Outcome Additions (from code review)

- Added `apps/api/src/modules/translate/translate.gateway.spec.ts` — 6 tests covering shared-contract validation (valid events → NotImplemented; malformed/legacy/mismatched → WsException).
- Fixed pre-existing drift in `packages/types/src/events/ws-events.ts`: `client.session.start` now uses `translationDirectionSchema` instead of inlined enum literals.
- Follow-up deferred to streaming implementation: register a WS exception filter that emits the shared `server.error` event (`WsException` is not visible to `ws`-adapter clients today; gateway is a stub with zero senders, so non-blocking).

## Implementation Steps

1. Sweep: `grep -rn "^\(export \)\?\(interface\|type\) [A-Z]" apps/ --include="*.ts*"` — classify each hit: (a) mirrors a shared type → consolidate, (b) app-local by nature (React props, env infer, theme, UI-only) → keep, (c) persistence layer (`UserRecord`, `SessionRecord`, `CreateUserDto`, `CreateSessionDto`, `AuthClaims`, `UserIdentity`) → keep, intentional.
2. Confirm the intentional keeps are stated in code where ambiguity is likely (the user-repository and session-store interfaces already carry doc comments — extend only if unclear; no plan-ID references in comments).
3. Gates, in order: `pnpm typecheck` → `pnpm lint` → `pnpm build` (full workspace).
4. Optional: `pnpm --filter @chatofy/api test` only if the local jest runner works this session (known-fragile: hoisted-linker dual-jest; CI does not run jest). Failure of the runner itself does not block the plan; real test regressions do.
5. Web smoke test if not already done in Phase 3.

## Success Criteria

- [ ] Sweep report: zero unconsolidated mirrors of shared types
- [ ] `pnpm typecheck` green
- [ ] `pnpm lint` green
- [ ] `pnpm build` green
- [ ] Translate flow smoke-tested (both directions)

## Risk Assessment

Low — audit + gates. Main risk is over-consolidating: category (b)/(c) types must stay local; when in doubt, keep local and note why.
