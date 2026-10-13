# Phase 4 — In-meeting chat with per-recipient translation

**Status: REVIVED (2026-10-14).** The user chose to build it, expanding the original cut scope:
chat IS translated per recipient, and it lives in its own panel. Decisions on record below.

**Goal:** text chat inside a meeting — type, send, everyone in the room sees it **in their own
chosen language**. A vi speaker's message reaches an en participant in English and vice versa,
mirroring how subtitle/audio translation already routes by each peer's join `sourceLanguage`.
Still deliberately NOT the full `messaging` module (controller + Prisma store + persistent
translation cache); persistence and history stay out of scope.

## Scope decisions (accepted)

- **Ephemeral, in-memory.** No DB persistence, no REST, no migration. Messages live for the
  meeting only (bounded ~200 per client).
- **Per-recipient translation, server-side.** The gateway translates each message into the
  distinct recipient languages in the room, reusing `PipelineTranslatorService.translateAll`
  (`apps/api/src/modules/translate/services/pipeline-translator.service.ts:568`). A recipient
  who shares the sender's language gets the original text. "Depends on user settings" = each
  participant's own language choice captured at join.
- **One WS event pair** on the **existing** `/ws/conference` gateway — no new route. Mirrors how
  translation broadcast was added.
- **Separate chat panel** (user's explicit choice over a tabbed aside). It MUST be a flat region
  — no `shadow-elev-md/lg`, no `data-slot="card"` — so the screen stays within ≤2 elevated
  surfaces. Input + send are ghost/outline; the one accent control stays Leave.

## Module wiring (new cross-module dependency)

- `apps/api/src/modules/translate/translate.module.ts` — add `exports: [PipelineTranslatorService]`.
- `apps/api/src/modules/conference/conference.module.ts` — import `TranslateModule` so the gateway
  can inject `PipelineTranslatorService`.

## Files this phase owns

- `apps/api/src/modules/translate/translate.module.ts` (edit: export `PipelineTranslatorService`).
- `apps/api/src/modules/conference/conference.module.ts` (edit: import `TranslateModule`).
- `apps/api/src/modules/conference/conference.gateway.ts` (edit: inject `PipelineTranslatorService`;
  add `conference.chat` subscribe that translates per distinct recipient language and fans
  `conference.chat.message` per peer via the existing `broadcastToSocket`; reply to sender with
  the original).
- `packages/types/src/events/conference-chat-events.ts` (new: zod schema for the message).
- `apps/web/src/hooks/use-conference.ts` (edit: `sendChat(text)` + a `messages` array in state).
- `apps/web/app/(app)/conference/[roomId]/components/chat-panel.tsx` (new).
- `packages/i18n/src/**` (edit: chat strings, en + vi).

## Steps

1. **Contract.** `ConferenceChatMessageSchema = { id, socketId, displayName, text, lang, sentAt }`
   — `lang` is the language of `text` as delivered to THIS recipient (so the client can label /
   right-to-left later if needed).
2. **Gateway handler.** `@SubscribeMessage('conference.chat')`: resolve sender peer (has
   `displayName` + `sourceLanguage`). Collect the distinct `sourceLanguage` values of the OTHER
   peers in the room. For those that differ from the sender, `translateAll({ text, source:
senderLang, targets })`; map each target to its translated string. Then for each recipient
   peer, `broadcastToSocket(peer.socketId, 'conference.chat.message', { …, text: translatedOrOriginal,
lang: recipientLang })`. `reply` to the sender with the original text + sender lang. No
   persistence. If `translateAll` throws, fall back to delivering the original text to everyone
   (chat must not break on a provider hiccup — log and degrade).
3. **Hook.** `sendChat(text)` sends `conference.chat`; on `conference.chat.message` append to a
   bounded `messages` array (cap ~200 for the meeting). Expose `messages` + `sendChat` on the
   return surface (append fields, do not rename existing ones).
4. **chat-panel.tsx.** A **separate flat region** (NOT an elevated card): message list + input.
   Tokens + i18n; input + send are ghost/outline (the screen's one accent control stays Leave —
   respect the ≤2 elevated-surface budget, so this panel adds zero elevated surfaces).

## Verification

- A vi participant's message appears to an en participant **in English**, and the reverse; a
  same-language participant sees the original. Not delivered to other rooms.
- Provider failure path: `translateAll` throwing still delivers the original text to everyone.
- `pnpm --filter web typecheck` + web/api build green; design specs still green with the chat
  panel mounted (no new elevated surface); no new Prisma migration (ephemeral by design).

## Acceptance criteria

- In-room chat works across all participants, each reading in their own language. No DB, no new
  module, no migration. Design budget preserved.

## Risk / rollback

Additive. Rollback = revert the gateway handler, delete the new type file + component + hook
additions. If cut, delete this phase file's tasks; nothing else depends on it.
