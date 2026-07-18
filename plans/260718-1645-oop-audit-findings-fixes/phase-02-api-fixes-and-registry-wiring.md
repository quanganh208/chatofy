---
phase: 2
title: API fixes and registry wiring
status: completed
priority: P2
dependencies:
  - 1
---

# Phase 2: API fixes and registry wiring

## Overview

Consume Phase 1 contracts in `apps/api`: wire `ProviderRegistry` into the factory (kills hardcoded name if/else), replace pipeline MIME map with `trio.tts.outputMimeType`, fix LSP stubs, encapsulation leaks, DIP env reads, dead injection.

## Requirements

- Functional: audit api findings #1(consumer half),#2,#3,#4,#5,#6 + registry wiring decision + map new `ProviderResponseError` in `handlePipelineError`.
- Non-functional: identical runtime behavior for existing flows (factory cache semantics, HTTP status mapping) — locked by tests before change.

## Architecture

- `AiProvidersFactory` constructs a private `ProviderRegistry`, registers elevenlabs/gemini/vieneu entries in constructor, `makeProviders` resolves by name via typed `resolve` — unknown name throws `ProviderNotImplementedError` (registry's own miss path replaces manual `if (name !== ...)` throws). Instance cache stays in factory (registry creates per-resolve; cache key unchanged: all variance axes).
- Pipeline: delete `OUTPUT_MIME_BY_LANG`; response uses `trio.tts.outputMimeType`. `handlePipelineError` adds `ProviderResponseError` branch (503, same generic message pattern).
- Stubs: `NoopAuthAdapter`, `NoopTranslatorService`, `PrismaUserRepository` methods become `async` (rejected promise instead of sync throw).
- `MemorySessionStore`: return `{ ...session }` copies; `updateSession` filters `undefined` dto keys before spread.
- `main.ts`: CORS/PORT via `app.get(ConfigService)` after create (PrismaService keeps direct env — constructor runs pre-DI, documented exception).
- `translate.gateway.ts`: remove unused `translator` injection until streaming lands.

## Related Code Files

- Modify: `apps/api/src/modules/translate/providers/ai-providers.factory.ts` — registry wiring.
- Modify: `apps/api/src/modules/translate/services/pipeline-translator.service.ts` — MIME map removal, error branch.
- Modify: `apps/api/src/modules/auth/adapters/noop-auth.adapter.ts`, `apps/api/src/modules/translate/services/noop-translator.service.ts`, `apps/api/src/modules/users/repositories/prisma-user.repository.ts` — `async` methods.
- Modify: `apps/api/src/modules/sessions/stores/memory-session.store.ts` — copies + undefined filter.
- Modify: `apps/api/src/main.ts` — ConfigService for CORS/PORT.
- Modify: `apps/api/src/modules/translate/translate.gateway.ts` — drop dead injection (and its module wiring if now unused there).
- Modify (tests): `ai-providers.factory.spec.ts`, `pipeline-translator.service.spec.ts`, `translate.gateway.spec.ts`, + new `memory-session.store.spec.ts`.

## Implementation Steps (TDD)

1. **Tests first** (`pnpm --filter @chatofy/api test`):
   - Factory spec: lock cache behavior (same profile+lang → same instances; different voice/lang → new), unknown-provider throw type, TTS routing en→elevenlabs / vi→vieneu. Must stay green unchanged after wiring.
   - Pipeline spec: lock response `audioMimeType` per direction; new red assertion — mime comes from provider (mock tts with custom `outputMimeType`); `ProviderResponseError` → 503.
   - New store spec (red): `getSession` result mutation does not corrupt store; `updateSession({field: undefined})` keeps old value; missing-id throw.
   - Stub spec (red): `NoopAuthAdapter.verifyToken().catch()` receives rejection (async contract).
2. Wire registry in factory; keep cache; delete manual name checks.
3. Pipeline MIME + error branch.
4. `async` stubs; store copies + undefined filter.
5. `main.ts` ConfigService; remove gateway dead injection (gateway spec adjusted — handlers still NotImplemented).
6. Full gates: `pnpm --filter @chatofy/api test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.

## Success Criteria

- [x] All api jest specs green; pre-existing factory/pipeline assertions unmodified (behavior lock held)
- [x] Grep: no provider-name string conditionals left in factory; no `OUTPUT_MIME_BY_LANG`
- [x] Adding a fake 4th provider in a spec = one `register()` call, zero factory/pipeline edits (OCP proof test)
- [x] Stub `.then/.catch` callers receive rejections (no sync throw from Promise methods)
- [x] Store leaks fixed per spec; CORS/PORT read via ConfigService

## Risk Assessment

- Registry wiring touches provider construction — factory cache regression is main risk; step-1 locked specs are the guard.
- Gateway module wiring: removing `translator` injection may orphan the `TRANSLATOR_SERVICE` provider binding — keep binding (controller path unaffected) unless typecheck says otherwise.
- Rollback: phase is one commit; revert restores if/else factory.
