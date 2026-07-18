# Shared Types Consolidation: Scope Discipline Pays Off

**Date**: 2026-07-18 14:00
**Severity**: Low
**Component**: @chatofy/types, web translate, mobile auth/ws interfaces
**Status**: Resolved

## What Happened

User asked via /brainstorm to refactor messy code, unify duplicated types, implement proper OOP/interfaces. Scout found architecture was already sound—schema-first (@chatofy/types zod), interface+registry pattern (@chatofy/ai-providers), NestJS DI tokens all correct. Real problem: 5 localized contract drift points scattered across apps. User chose scope C (comprehensive, 4 phases). All phases shipped. 4 commits, tests green, docs updated.

## The Brutal Truth

Initial fear: user wanted massive OOP refactor across codebase. Reality: user valued the scout verdict and accepted surgical fixes. Explicitly rejected OOP-ifying React components (they're fine as is) and merging persistence types into domain types (dangerous—conflates DB shape with domain logic). The win here isn't the code refactored. It's that we didn't waste a week rewriting things that worked.

## Technical Details

**Phase 1** — consolidated 5 drift points:

- web local `Direction` → shared `TranslationDirection` enum
- mobile `AuthSession {userId, accessToken}` → shared `{user, token}` (name collision with divergent shape was the most dangerous finding; would have broken runtime)
- api translate.gateway.ts inline WS payloads → shared `ClientEventSchema` zod validation
- health.controller inline `HealthResponse` → `HealthDto`
- VIENEU_VOICES (14 presets) → @chatofy/types export

**Phase 2** — dropped I-prefix from 4 mobile interfaces: `AuthClient`, `WsClient`, `AudioRecorder`, `AudioPlayer`. Cleaner, matches web convention.

**Phase 3** — web translate page: 287→72 LOC (75% reduction). Extracted `use-translate-turn` hook + 5 components under src/components/translate/. 5th component (audio-source-controls) added beyond plan to satisfy <100 LOC criterion. All leaf components now testable in isolation.

**Phase 4** — boundary sweep. All gates green: typecheck 10/10, lint 5/5, build 5/5, api jest 55/55, Playwright smoke /translate both directions.

## What We Tried

Considered broader OOP patterns (interface hierarchies, abstract base classes). Rejected: real problem was naming and validation, not design. Interface naming was already correct; removing I-prefix improved clarity without loss. Did not attempt to merge User/Session records into domain types—persistence shape must drift from domain to optimize queries; conflating them creates brittle code.

## Root Cause Analysis

Contract drift happened because types lived in app-local files with no single source of truth. Developers weren't being careless; they were solving immediate problems without visibility into parallel contracts elsewhere. No tooling forced convergence. This is a discovery problem, not a behavior problem. @chatofy/types as single source solved it.

## Lessons Learned

1. **Scout before designing**: Architecture was sound. The design wasn't broken; visibility was. An audit asking "should we redesign?" wastes time if the answer is "no, we need a registry."
2. **Respect rejection criteria**: User rejected OOP-ifying components because they have correct shape. We respected that. Forced abstraction when something works creates technical debt, not value.
3. **Memory requires validation**: Prior memory said "api jest fails under hoisted-linker dual-jest." This session: jest 55/55 green locally. Memory updated to "currently working; can flip per pnpm install." Don't trust broken-in-past without reproduction.
4. **Localized fixes scale**: 5 drift points fixed in Phase 1, page refactored in Phase 3. No big architecture rewrite needed. Scope discipline (choosing C carefully, not unlimited) kept delivery fast.

## Next Steps

1. Push commits (awaiting user approval).
2. Monitor WS exception filter: today's gateway is stub (zero senders). When real streaming lands, WsException must emit server.error event back to client. Currently deferred; spec'd for next phase.
3. Watch for regressions in auth flow (mobile AuthSession shape change). Manual smoke OK; consider adding mobile auth e2e if feasible.

**File impacted:**

- D:\QuangAnh\chatofy\docs\system-architecture.md (web structure updated)
- Commits: a5852ec, 383af91, d88d1be, 8369a99

---

**Status**: DONE
**Summary**: Consolidated 5 localized type drift points, refactored web translate page 287→72 LOC, all tests green. Scope discipline avoided architecture rework; real problem was visibility, not design.
