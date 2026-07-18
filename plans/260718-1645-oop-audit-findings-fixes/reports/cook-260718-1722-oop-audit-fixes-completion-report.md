# OOP Audit Fixes — Completion Report

Date: 2026-07-18 17:22 (+07). Plan: `plans/260718-1645-oop-audit-findings-fixes/` — 4/4 phases done.

## Delivered (TDD: behavior locked by tests before every change)

**Phase 1 — packages/ai-providers + types**

- `ProviderError` abstract base; new `ProviderResponseError` (non-2xx/malformed, carries `status`) vs `ProviderConnectionError` (transport only, `cause` preserved). All 4 providers migrated.
- `TtsProvider.outputMimeType` (elevenlabs mp3, vieneu wav).
- `ProviderRegistry` typed via `ProviderKindMap` mapped type — kind/type mismatch fails typecheck (`@ts-expect-error` guard in spec).
- `provider-factory.ts` → `provider-env.ts`; comment drift + no-op `?? undefined` fixed.
- Canonical `languageCodeSchema` in `@chatofy/types` (only `z.enum(['vi','en'])` left in repo); ai-providers imports `LanguageCode` type-only (zod stays out of runtime).
- Schema naming unified camelCase (`audioFrameSchema`, `clientEventSchema`, …), all consumers migrated.

**Phase 2 — apps/api**

- `ProviderRegistry` wired at composition root (`translate.module.ts` + `register-default-providers.ts`); factory has zero provider-name construction conditionals. OCP proof spec: fake 4th provider = one `register()` call.
- Pipeline reads `trio.tts.outputMimeType` (MIME map deleted); `ProviderResponseError` → 503.
- Stubs (`NoopAuthAdapter`, `NoopTranslatorService`, `PrismaUserRepository`) async → reject, never sync-throw (LSP).
- `MemorySessionStore` returns copies; undefined dto fields no longer clobber. New spec.
- `main.ts` CORS/PORT via validated ConfigService; dead `translator` injection removed from gateway.

**Phase 3 — packages/api-client**

- `NetworkError(timedOut, cause)` completes typed failure set; timeout timer covers body read; classification via `signal.aborted` (runtime-proof); `getHeaders()` failures propagate raw (not masked as network). New vitest harness, 8 specs (incl. 502-HTML status-first regression lock).

**Phase 4 — apps/web + mobile**

- `runTranslate` ref-based re-entrancy guard (sync, render-lag-proof); `NetworkError` user message; reset fires on re-record (`onSourceReplaced`); `blobToBase64` → `src/lib/`.
- `NativeWSClient.connect` detaches old handlers, closes prior socket, `onclose` guarded vs replacement race.
- Auth context `useMemo`/`useCallback`; scaffold files header-noted as roadmap placeholders.

## Verification

- Tester agent (independent): api jest 72/72, api-client vitest 8/8, typecheck 10/10, lint 0 errors (6 pre-existing spec warnings), build 5/5. Report: `reports/tester-260718-1721-refactor-completion-verification-report.md`.
- Code-reviewer agent: all acceptance criteria verified, 0 critical; 2 medium + 3 low findings — **all fixed** post-review (camelCase rename artifacts, ref guard, WS handler detach, abort classification, getHeaders placement) and gates re-run green.
- Manual web UI (Playwright, live dev server): page renders on refactored code, Translate disabled without audio, EN→VI voice picker (14 VieNeu voices), record path + mic-denied handling OK. Full record→translate→re-record E2E needs mic + API keys — deferred to user smoke test.

## Notes / accepted deviations

- `targetLang==='vi' → 'vieneu'` routing conditional remains in factory by design (product decision: vi always via VieNeu sidecar) — routing policy, not construction.
- `api-client/tsconfig.json` uses relative `extends` (vite:oxc cannot resolve package-name extends) — commented inline.
- `TRANSLATOR_SERVICE` binding kept with zero consumers — reserved for streaming path.
- Mobile WS fix verified by review+typecheck only (no runtime consumer yet).

## Unresolved questions

None blocking. Optional: verify RN fetch abort rejection shape when conversation feature lands (api-client `timedOut` best-effort on exotic runtimes).
