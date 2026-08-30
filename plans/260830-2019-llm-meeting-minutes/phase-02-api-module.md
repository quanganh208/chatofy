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

## Resolved (continued)

- [x] **Error → HTTP mapping.** `MinutesService` now maps a provider failure via
      `asHttpError`: `ProviderConfigError` / `ProviderConnectionError` → 503
      (`ServiceUnavailableException`), `ProviderResponseError` → 502
      (`BadGatewayException`); anything else stays 500. The `AllExceptionsFilter`
      forces a generic message on every 5xx, so status differs while nothing
      leaks. Covered by `minutes.service.spec.ts`.
- [x] **Unit tests** — `gemini-summarization-provider.spec.ts` (SDK mocked: valid
      JSON, partial coercion, action-item filtering, non-JSON/empty →
      `ProviderResponseError`, `responseMimeType` assertion),
      `minutes.service.spec.ts` (draft→domain mapping with minted ids, `failed`
      persisted + 503/502 rethrow, owner-scoped reads),
      `memory-minutes.store.spec.ts` (owner isolation, overwrite),
      `minutes.controller.spec.ts` (owner from token, 404).
- [x] **e2e** — `test/minutes.e2e-spec.ts`: full AppModule with the
      `ProviderRegistry` overridden by a fake summarizer. Round-trips POST→GET,
      401 without a token, 404 for a foreign/absent session (no leak), and 400 on
      an empty or over-`MAX_TOTAL_CHARS` transcript.

## Remaining in this phase

_None — phase 2 complete. Persistence is phase 4; UI is phase 3._

## Verify

Green as of 2026-08-30: `tsc --noEmit` for `@chatofy/types` / `@chatofy/ai-providers` /
`apps/api`; `jest` full unit suite **810 passed / 55 suites**; `jest --config
test/jest-e2e.json minutes` **6 passed**.
