# Brainstorm Report — Shared Types Consolidation + Repo-wide Interface Refactor

- Date: 2026-07-18 16:11 (+07)
- Session: /brainstorm (ultrathink)
- Scope decision: **C — Toàn diện** (user-selected; A/B offered, C chosen)
- Status: Design approved by user → handoff to /ck:plan

## Problem Statement

User perception: code messy, types duplicated per service, wants OOP/interface refactor.

Scout verdict: foundation already solid — `@chatofy/types` (zod schema-first, domain/http/events), `@chatofy/ai-providers` (interfaces + providers + registry + error hierarchy), `@chatofy/api-client` shared by web+mobile, NestJS api uses DI tokens + repository/adapter patterns. Real problem = **localized contract drift**, not architecture.

## Confirmed Findings (evidence-based)

1. **Name collision, divergent shape**: `AuthSession` in `apps/mobile/src/clients/auth-client.interface.ts:2` = `{userId, accessToken}` vs shared `AuthSession` in `packages/types/src/http/auth.ts` = `{user, token}`. Hazard when real auth wired.
2. **Local re-declaration**: `Direction` at `apps/web/app/translate/page.tsx:19` duplicates `TranslationDirection` (`@chatofy/types`).
3. **WS contract drift**: `translate.gateway.ts` handlers take inline payloads (`{sessionId, sourceLang, targetLang}`) diverging from shared `ClientEventSchema` (`client.session.start` = `{type, direction}`). Gateway is stub → cheap to fix now.
4. **Inline DTO bypass**: `HealthResponse` inline in `health.controller.ts:6` despite module's `dto/health.dto.ts`.
5. **Hardcoded data**: `VIENEU_VOICES` (14 voices) in web page; sidecar `GET /voices` is source of truth.
6. **Naming inconsistency**: mobile uses `I`-prefix (`IAuthClient`, `IWSClient`, `IAudioRecorder`, `IAudioPlayer`); api + ai-providers use no prefix.
7. **Oversized file**: `apps/web/app/translate/page.tsx` 287 LOC (repo guideline: 200) — state machine + timer + upload + UI in one component.

## Non-Findings (do NOT "fix")

- `UserRecord`/`SessionRecord` (api persistence) vs `User`/`ConversationSession` (domain): intentional layer separation (Date vs ISO string, updatedAt), mapper exists (`to-user.mapper.ts`). Merging = regression.
- React components: function+hooks is ecosystem convention. No class/OOP conversion.
- NestJS side already OOP/interface-correct; no further abstraction warranted (YAGNI).

## Evaluated Approaches

| Option                    | Scope                             | Verdict                                                                                                    |
| ------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| A. Types-only             | Fix findings 1,2,4,5              | Safe, ~½ day; leaves naming + oversized page                                                               |
| B. Types + web page split | A + finding 7                     | Advisor-recommended balance                                                                                |
| C. Comprehensive          | B + findings 3,6 + boundary audit | **User-selected** — acceptable since C's extra items are concrete drift fixes, not speculative abstraction |

User decisions: scope = C; mobile `AuthSession` → **align to shared type** (not rename-local).

## Agreed Design (4 phases)

### Phase 1 — Consolidate types into `@chatofy/types`

1. Web `Direction` → import `TranslationDirection`.
2. Mobile `AuthSession` → shared `{user, token}`; update `auth-client.stub.ts`, `auth-provider.tsx`, call sites.
3. Gateway: parse incoming WS messages with shared `ClientEventSchema` (zod discriminated union); delete inline payload types.
4. Health controller → use existing `dto/health.dto.ts`.
5. `VIENEU_VOICES` → constant exported from `@chatofy/types` (web+mobile share). Dynamic fetch from sidecar `/voices` deferred (YAGNI).

### Phase 2 — Interface naming standardization

- Drop `I`-prefix in mobile: `IAuthClient`→`AuthClient`, `IWSClient`→`WsClient`, `IAudioRecorder`→`AudioRecorder`, `IAudioPlayer`→`AudioPlayer`. Keep `*.interface.ts` filenames (already consistent).

### Phase 3 — Modularize web translate page (287 → <100 LOC)

- `apps/web/src/hooks/use-translate-turn.ts` — request state machine (loading/result/error) + elapsed timer.
- `apps/web/src/components/translate/`: `direction-toggle.tsx`, `voice-picker.tsx`, `quality-card.tsx`, `result-card.tsx`.
- `page.tsx` = composition only.

### Phase 4 — Boundary audit + verify

- Sweep remaining local types mirroring shared ones; document intentional keeps (UserRecord/SessionRecord).
- Gates: `pnpm typecheck`, `pnpm lint`, `pnpm build` full workspace. Local jest known-fragile (hoisted-linker dual-jest) — typecheck/build are primary gates; run api specs only if runner healthy.

## Risks

- Mobile auth shape change: touches stub+provider; auth not wired to real backend → low risk, cheapest time to fix.
- Gateway zod parse: all handlers currently throw NotImplemented → no behavior break.
- Web page split: pure UI refactor; smoke test record→translate→play flow.

## Success Criteria

- Zero local re-declarations of types that exist in `@chatofy/types` (excluding documented persistence-layer keeps).
- One interface naming convention repo-wide (no `I`-prefix).
- `translate/page.tsx` < 100 LOC; no behavior change in translate flow.
- typecheck + lint + build green across workspace.

## Next Steps

- `/ck:plan` from this report (default mode recommended; --tdd rejected due to fragile local jest — see memory: CI runs no jest, gates are typecheck/lint/build).

## Unresolved Questions

- None blocking. Deferred: dynamic voice list endpoint (api proxy of sidecar `/voices`).
