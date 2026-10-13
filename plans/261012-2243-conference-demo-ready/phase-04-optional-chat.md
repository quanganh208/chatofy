# Phase 4 — _(Optional / stretch)_ lightweight in-meeting chat

**Status: OPTIONAL.** Build only if Phases 1–3 land with time to spare. Default decision at
plan time: **cut unless explicitly revived.** Confirm with the user before starting.

**Goal:** a minimal text chat inside a meeting — type, send, everyone in the room sees it — with
the **smallest** possible footprint. Deliberately NOT the full `messaging` module from the
architecture doc (controller + Prisma store + translation cache); that is over-scope for a demo.

## Scope decision: ephemeral, in-memory

- No DB persistence, no REST, no message-translation caching. Messages live for the meeting only.
- One new WS event pair on the **existing** `/ws/conference` gateway — no new module, no new
  route. This mirrors how translation broadcast was added.

## Files this phase owns

- `apps/api/src/modules/conference/conference.gateway.ts` (edit: add `conference.chat` subscribe
  that fans `conference.chat.message` to the room via the existing `broadcast`).
- `packages/types/src/events/conference-chat-events.ts` (new: zod schema for the message).
- `apps/web/src/hooks/use-conference.ts` (edit: `sendChat(text)` + a `messages` array in state).
- `apps/web/app/(app)/conference/[roomId]/components/chat-panel.tsx` (new).
- `packages/i18n/src/**` (edit: chat strings, en + vi).

## Steps

1. **Contract.** `ConferenceChatMessageSchema = { id, socketId, displayName, text, sentAt }`.
2. **Gateway handler.** `@SubscribeMessage('conference.chat')`: resolve peer, stamp
   `socketId`/`displayName`/`sentAt`, `broadcast` (and reply to sender) a
   `conference.chat.message`. No persistence.
3. **Hook.** `sendChat(text)` sends `conference.chat`; on `conference.chat.message` append to a
   bounded `messages` array (cap ~200 for the meeting).
4. **chat-panel.tsx.** Collapsible panel: message list + input. Tokens + i18n; a region, input is
   ghost/outline (the screen's one accent control stays Leave — respect the design budget).

## Verification

- Message typed in tab A appears in tabs B and C within the same room; not delivered to other
  rooms.
- `pnpm typecheck` + web/api build green; no new Prisma migration (ephemeral by design).

## Acceptance criteria

- In-room ephemeral chat works across all participants. No DB, no new module.

## Risk / rollback

Additive. Rollback = revert the gateway handler, delete the new type file + component + hook
additions. If cut, delete this phase file's tasks; nothing else depends on it.
