---
phase: 6
title: 'API module — routes, service, controller specs'
status: complete
priority: P2
effort: '5h'
dependencies: [5]
---

# Phase 6: API module — routes, service, controller specs

## Goal

Serve the context library over three owner-scoped routes, shaped on
`apps/api/src/modules/conversations/`.

## Files to Create / Modify

- Create: `apps/api/src/modules/translation-contexts/translation-contexts.module.ts`
- Create: `apps/api/src/modules/translation-contexts/translation-contexts.controller.ts`
- Create: `apps/api/src/modules/translation-contexts/translation-contexts.controller.spec.ts`
- Create: `apps/api/src/modules/translation-contexts/translation-contexts.service.ts`
- Create: `apps/api/src/modules/translation-contexts/translation-contexts.service.spec.ts`
- Create: `apps/api/src/modules/translation-contexts/dto/translation-contexts.dto.ts`
- Modify: `apps/api/src/app.module.ts`

## Tasks & Steps

1. `dto/translation-contexts.dto.ts`, following
   `apps/api/src/modules/conversations/dto/conversations.dto.ts`:
   - `translationContextIdParamSchema = z.object({ contextId: z.uuid() })`, with
     the docblock that file carries at `:13-20` — not decoration: the value goes
     into a btree unique index and Postgres refuses an index tuple over ~2704
     bytes, so an unvalidated multi-kilobyte id is a 500 where a 400 belongs.
   - `createZodDto` classes for the save body, the id param, and the two response
     payloads (for the OpenAPI envelope).
2. `translation-contexts.service.ts` — thin: injects
   `TRANSLATION_CONTEXT_STORE`, and enforces `MAX_CONTEXTS_PER_OWNER` by
   counting first and refusing with a `ConflictException` **only when the id is
   not already among the caller's** (a replace of an existing context must
   always be allowed, or a full library becomes uneditable).
3. `translation-contexts.controller.ts`:
   - `GET /translation-contexts` → `{ contexts: [...] }`, unpaged (bounded by
     `MAX_CONTEXTS_PER_OWNER`), `@Throttle({ default: { limit: 60, ttl: 60_000 } })`.
   - `PUT /translation-contexts/:contextId` → 200, idempotent create-or-replace,
     `@Throttle({ default: { limit: 30, ttl: 60_000 } })`. A PUT for the same
     reason `PUT /conversations/:id` is one
     (`packages/types/src/http/conversations.ts:3-7`).
   - `DELETE /translation-contexts/:contextId` → 204, cascading `GlossaryTerm`.
   - `@UseGuards(ThrottlerGuard)` on the class, applied explicitly and NOT
     inherited: there is no global throttle in this app — the only `APP_GUARD` is
     `JwtAuthGuard` — so a route that does not ask for a limit does not have one
     (`conversations.controller.ts:37-50`).
   - The owner is always `req.auth!.userId`, never a path or body field.
4. `translation-contexts.module.ts`, following
   `conversations.module.ts`: `useClass` not `useFactory` — which backend stores
   a context is not a deployment choice, and a switch there is what made minutes
   silently non-durable by default. Do **not** export the store token; nothing
   else injects it.
5. Register `TranslationContextsModule` in `app.module.ts` (`:19-33`).
6. `translation-contexts.controller.spec.ts`, with a fake store, asserting by
   name:
   - `GET returns only the caller's contexts`
   - `PUT for an id owned by another account creates a NEW row for the caller and
never touches theirs` — the `(ownerId, clientId)` scoping makes a guessed id
     resolve to nothing rather than to a unique violation that would reveal the
     row exists
   - `the 21st create is refused with 409`
   - `a replace of an existing context is allowed even at the ceiling`
   - `DELETE answers 204 for an id that was never there`
   - `a non-uuid contextId is refused with 400`
7. `translation-contexts.service.spec.ts` — the ceiling arithmetic and the
   count-then-decide ordering, apart from HTTP.

## Verification

- `pnpm --filter api test translation-contexts`
  → prints the two new spec files with **at least 9 passed**, 0 failed.
- `pnpm --filter api test` → the whole api suite green, 0 failed.
- `pnpm --filter api typecheck && pnpm --filter api lint` → both exit 0.
- Routes exist in the OpenAPI document:
  ```bash
  pnpm --filter api build && grep -c "translation-contexts" apps/api/dist/modules/translation-contexts/translation-contexts.controller.js
  ```
  → prints a number ≥ 1.
