# Phase 2 — API minutes module

**State: skeleton landed on `feat/meeting-minutes-llm`; harden + test.**

## Delivered

`apps/api/src/modules/minutes/`:

- `interfaces/minutes-store.interface.ts` — `MINUTES_STORE` token + `MinutesStore`.
- `stores/memory-minutes.store.ts` — `MemoryMinutesStore`.
- `dto/minutes.dto.ts` — `createZodDto` over the shared schemas.
- `minutes.service.ts` — build transcript, `resolveOnly('summarization')`,
  draft→domain mapping (mint ids + timestamp), persist `failed` before rethrow.
- `minutes.controller.ts` — `POST` generate + `GET` read (404 when none).
- `minutes.module.ts` — provides its own `ProviderRegistry` via the shared
  composition root; binds `MINUTES_STORE` → `MemoryMinutesStore`.
- `register-default-providers.ts` — `summarization: gemini` registration added.
- `app.module.ts` — `MinutesModule` imported.

## Resolved

- [x] **Auth/ownership check.** Chosen: scope minutes by the authenticated
      caller rather than by session lookup. The `MinutesStore` is keyed by
      `(ownerId, sessionId)` where `ownerId` is the verified token's subject
      (`req.auth!.userId`), read from the token and never from the path/body. A
      foreign or guessed `sessionId` resolves to `null` → 404 (leaks nothing).
      This holds even though sessions are not persisted with ownership today,
      because it does not depend on a session lookup. When `SessionsService`
      grows real ownership, an additional "session belongs to caller" assert can
      layer on top — but the IDOR on stored minutes is closed now.
- [x] **Transcript size ceiling.** `generateMinutesRequestSchema` now caps
      per-turn length, speaker-label length, turn count, and a total-character
      ceiling via `MINUTES_LIMITS` in `@chatofy/types`, with a `.refine` for the
      summed transcript (the value actually billed). Over-limit → 400
      VALIDATION_FAILED through the global `ZodValidationPipe`.

## Remaining in this phase

- [ ] **Error → HTTP mapping.** Confirm `ProviderConfigError` (no key) and
      `ProviderConnectionError` (all cooling down) surface as sane statuses
      through the existing exception filter, not a bare 500.
- [ ] Controller + service unit tests (mock the provider): happy path returns
      `ready` with minted ids; provider throw persists `failed` then rethrows;
      GET 404 when empty; GET returns a stored `failed` record.
- [ ] e2e: `POST` then `GET` round-trips through the real Nest app with a stubbed
      registry (no live Gemini call in CI).

## Verify

`pnpm turbo run typecheck --filter=@chatofy/api` green; the module boots
(`AppModule` compiles); unit + e2e above pass.
