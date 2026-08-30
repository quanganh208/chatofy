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

## Remaining in this phase

- [ ] **Auth/ownership check.** Routes are behind the global `JwtAuthGuard`, but
      the handler does not yet assert the caller OWNS `:sessionId`. Decide: look
      the session up via `SessionsService` and 403 on a foreign user, or accept
      that sessions are not yet user-scoped for minutes and note it. **Needs a
      product decision — do not silently ship an IDOR.**
- [ ] **Transcript size ceiling.** `generateMinutesRequestSchema` bounds only
      `min(1)`. A whole meeting can be large and this is an unauth— no, it is
      authed, but still an LLM-cost lever. Add a max turn count / total-chars cap
      in the schema (mirror the hint caps in `prompt-builder.ts`).
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
