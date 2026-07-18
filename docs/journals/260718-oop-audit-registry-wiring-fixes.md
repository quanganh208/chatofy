# Audit to Fix in One Session: ProviderRegistry OCP Completion

**Date**: 2026-07-18 17:22
**Severity**: Medium
**Component**: @chatofy/ai-providers, @chatofy/types, apps/api, @chatofy/api-client, apps/web, apps/mobile
**Status**: Resolved

## What Happened

Audit landed PASS (0 critical, 1 medium, ~19 minor). User response: not "ship it"—execute the fixes. Chose `/ck:plan --tdd` → 4-phase fix plan spanning packages + all 3 apps. Same session: all phases cooked, all gates green (api jest 72/72, vitest 8/8, typecheck 10/10, build 5/5). Key decision: wired ProviderRegistry into composition root `register-default-providers.ts` (OCP end-to-end, app factory zero conditionals). TDD-locked behavior on every phase before implementation. Independent code reviewer caught 2 medium + 3 low findings—all fixed pre-commit.

## The Brutal Truth

Audit verdict = yes we're fine. User thought "fine" means "we can still improve." That pragmatism compressed what could have been "fix some findings, schedule rest" into a complete same-day refactor. The satisfaction is real—ProviderRegistry end-to-end wiring proves OCP at composition root. Real friction: mechanical sed rename harvested camelCase boundary artifacts; state variables masqueraded as sync primitives; tsconfig tooling forced relative extends + inline comment because vite:oxc can't resolve package-name in `extends:`. These aren't showstoppers but they sting because they're preventable.

## Technical Details

**Phase 1** — error hierarchy + registry typing:

- New `ProviderError` abstract base; `ProviderResponseError` (non-2xx/malformed, carries `status`) vs `ProviderConnectionError` (transport only).
- `ProviderRegistry` typed via `ProviderKindMap` mapped type—kind/type mismatch fails typecheck.
- Canonical `languageCodeSchema` in @chatofy/types only; ai-providers imports `LanguageCode` type-only (no zod at runtime).
- Schema names unified camelCase (`audioFrameSchema`, `clientEventSchema`).

**Phase 2** — composition root wiring:

- ProviderRegistry + `register-default-providers.ts` at app factory. Zero provider-name conditionals in `PipelineTranslatorService`. OCP proof spec: adding 4th provider = one `register()` call.
- Stubs (`NoopAuthAdapter`, etc.) async-reject, never sync-throw (LSP).
- `MemorySessionStore` returns shallow copies (not live Map refs).
- `main.ts` CORS/PORT via validated ConfigService.

**Phase 3** — api-client typed failures:

- `NetworkError(timedOut, cause)` completes typed failure set. Classification via `signal.aborted` (not exception type). Timeout timer covers body read. New vitest harness, 8 specs.

**Phase 4** — web + mobile lifecycle safety:

- `runTranslate` ref-based re-entrancy guard (sync, render-lag-proof—not state-based `if (loading) return`).
- `NativeWSClient.connect` detaches old handlers, closes prior socket, `onclose` guarded vs replacement race.
- Auth context `useMemo`/`useCallback` stops re-renders.

## What We Tried

Considered: stop at audit verdict and backlog findings. Reality: user's risk tolerance favors fixing known problems end-to-end rather than death-by-a-thousand-minor-cuts. Attempted mechanical sed for schema rename (e.g., `AudioFrameSchema` → `audioFrameSchema`); grep sweep caught 4 boundary artifacts (camelCase + PascalCase mix in imports). Avoided: hiding vite:oxc tsconfig limitation—documented inline comment explaining relative extends. Did not attempt to consolidate RN fetch error handling (timeout rejection shape unknown on exotic runtimes—deferred to runtime verification when conversation feature lands).

## Root Cause Analysis

**Why audit findings existed**: ProviderRegistry was exported but app factory bypassed it via hardcoded conditionals. Transport errors (timeout, abort) escaped typed hierarchy. Re-entrancy guards relied on render-cycle semantics instead of explicit synchronization. WS lifecycle didn't close old sockets on reconnect. These aren't architectural failures—they're incomplete migration stories (error hierarchy added, but handlers not wired; guards added, but not consistently sync-based).

**Why mechanical sed bit us**: camelCase rename at file level doesn't catch consumers in other modules. Grep needs to target both import and schema references. Simple oversight but expensive (code reviewer had to re-verify).

**Why state-based guards fail**: `if (loading) return` gates on render cycle atomicity. Between the check and the side-effect, React can re-render; caller is unaware. Ref-based `inFlight.current` flag survives render cycles and stays consistent with actual async operation state.

## Lessons Learned

1. **Mechanical refactors need a compile-target grep sweep**: Schema rename `Schema_PascalCase → Schema` requires grep across consumers + imports. Don't trust sed alone—follow with typecheck + integration coverage.
2. **State variables are not synchronization primitives**: `if (loading)` gates on React's render cycle semantics; ref-based `inFlight.current` is render-lag-proof. For in-flight flags, prefer refs.
3. **Audit → plan → cook works when evidence is file:line specific**: Generic "encapsulation leak" requires design thinking. Audit report saying `line 52: runTranslate() no guard` + test spec for re-entrancy = cook accepts and fixes in same session.
4. **Jest hoist fragility is managed, not solved**: Jest 55→72 tests green locally after vitest install (both hoisted-linker bug + jest hook fixed since prior session). Memory stays: "can flip per pnpm install; verify after touching node_modules."
5. **Registry wiring at composition root completes OCP story**: Factory zero conditionals = open to new providers without touching factory code. Beats hardcoded `if (name === 'openai')` every time.

## Next Steps

1. Push 4 commits (awaiting user approval).
2. Manual web E2E (record → translate → re-record with audio device) when user has time—Playwright smoke verified refactored code renders; full path needs mic + API keys.
3. Mobile WS fix verified by review+typecheck only (no runtime consumer). When conversation feature lands, runtime-test socket lifecycle (reconnect after network interruption).
4. Watch api-client timeout rejection shape on React Native when streaming lands—best-effort on exotic runtimes until then.

**Files impacted:**

- packages/ai-providers, packages/types, packages/api-client, apps/api, apps/web, apps/mobile
- Commits: 863c17d, 2aea5c6, bd0acac, 1a6c620 (pending user merge)

---

**Status**: DONE
**Summary**: Executed audit findings via TDD 4-phase plan; wired ProviderRegistry into composition root (OCP completion), typed transport errors, fixed lifecycle guards. Code reviewer caught mechanical-sed artifacts and state-based race conditions—all fixed. All tests green; OCP end-to-end working.
