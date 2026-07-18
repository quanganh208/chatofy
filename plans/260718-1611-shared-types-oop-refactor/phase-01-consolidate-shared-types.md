---
phase: 1
title: Consolidate shared types
status: completed
effort: 0.5d
priority: P1
dependencies: []
---

# Phase 1: Consolidate shared types

## Overview

Make `@chatofy/types` the single source of truth for every cross-boundary type. Fix 5 confirmed drift points; no new abstractions.

## Requirements

- Functional: identical runtime behavior; only type sources change (except gateway, which gains zod parsing of already-stubbed handlers)
- Non-functional: no new type names when a shared one exists

## Related Code Files

- Modify: `packages/types/src/http/translate.ts` (add `VIENEU_VOICES` const — or new `packages/types/src/domain/voices.ts` exported via barrels)
- Modify: `apps/web/app/translate/page.tsx`
- Modify: `apps/mobile/src/clients/auth-client.interface.ts`
- Modify: `apps/mobile/src/clients/auth-client.stub.ts`
- Modify: `apps/mobile/src/providers/auth-provider.tsx` (+ any call sites: `app/(auth)/sign-in.tsx`, `sign-up.tsx`)
- Modify: `apps/api/src/modules/translate/translate.gateway.ts`
- Modify: `apps/api/src/modules/health/health.controller.ts`

## Implementation Steps

1. **Web `Direction` dup** — delete local `type Direction` (`apps/web/app/translate/page.tsx:19`); import `TranslationDirection` from `@chatofy/types`. `DIRECTION_TITLE` keys type against it.
2. **Mobile `AuthSession` align (user decision: align to shared)** — in `auth-client.interface.ts`, delete local `AuthSession {userId, accessToken}`; import `AuthSession` (`{user, token}`) from `@chatofy/types`. Update `IAuthClient` method signatures, `auth-client.stub.ts` (stub returns a shared-shape session: fake `user` per `userSchema` + fake `authTokenSchema` token), `auth-provider.tsx` context, and any screen reading `session.userId` → `session.user.id` / `session.token.accessToken`.
3. **Gateway WS contract** — replace inline payload types in `translate.gateway.ts` with shared contract: parse incoming messages via `ClientEventSchema` (zod discriminated union from `@chatofy/types`); handler payload types become `ClientSessionStart`/`ClientAudioFrame`/`ClientSessionEnd`. Note shared `client.session.start` carries `direction`, not `{sessionId, sourceLang, targetLang}` — update log lines accordingly. Handlers keep throwing `NotImplementedException` (streaming impl is out of scope).
4. **Health DTO** — delete inline `HealthResponse` (`health.controller.ts:6`); type the handler with the existing DTO in `modules/health/dto/health.dto.ts` (extend the DTO if a field is missing rather than keeping the inline type).
5. **`VIENEU_VOICES`** — move the 14-preset list from `apps/web/app/translate/page.tsx` into `@chatofy/types` (exported const, reachable from root barrel — api uses `moduleResolution: node`, root barrel only). Web imports it; keep the comment that sidecar `GET /voices` is runtime source of truth (dynamic fetch deferred — YAGNI).
6. Run `pnpm typecheck` and fix fallout before moving on.

## Success Criteria

- [ ] No local `Direction`, `AuthSession`, `HealthResponse`, or WS payload inline types remain in apps
- [ ] `VIENEU_VOICES` exported from `@chatofy/types`, consumed by web
- [ ] Gateway messages validated by `ClientEventSchema`
- [ ] `pnpm typecheck` green

## Risk Assessment

- Mobile auth shape change touches provider/stub/screens — auth not wired to a real backend yet, so blast radius is compile-time only; typecheck catches all call sites.
- Gateway handlers already throw NotImplemented — zod parse cannot break existing behavior.
