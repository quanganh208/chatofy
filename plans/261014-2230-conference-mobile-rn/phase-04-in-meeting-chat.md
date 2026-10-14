# Phase 4 — In-meeting chat (per-recipient translation)

**Goal:** a native chat panel in the call view with per-recipient translated messages, at parity
with web — closing full parity.

## Context

Per-recipient translation is **entirely server-side**: `apps/api` `conference.gateway.ts` receives
`conference.chat`, echoes the original to the sender in their language, and translates to **each
recipient's chosen language** via `translator.translateAll()`, sending every peer one message in
their own language. The client only sends `conference.chat { text }` and renders the resulting
`ConferenceChatMessage` (`{ id, socketId, displayName, text, lang, sentAt }` — `text` already in the
recipient's language). So the hook work is tiny (`sendChat` + a bounded `messages` array with
echo handling, both declared in the Phase 1 contract) and the UI is a standard list + input.

## Files this phase owns

- `apps/mobile/src/components/conference/chat-panel.tsx` — message list (own vs. others) + input,
  native parity with web `chat-panel.tsx`.
- Hook wiring in `use-conference-native.ts`: implement `sendChat(text)` → `send(ws,
'conference.chat', { text })`, accumulate incoming `ConferenceChatMessage` into `messages`
  (bounded, same cap as web), handle the sender echo.
- Call-view edit to mount the chat panel (e.g. a toggle/sheet alongside the transcript).
- i18n keys for the chat input placeholder + empty state in `packages/i18n/src/{en,vi}.ts`.

## Steps

1. **Read first:** `packages/types/src/events/conference-chat-events.ts` (`ConferenceChatMessage`);
   web `use-conference.ts` `sendChat` + `messages` accumulation (bound + echo logic) and
   `chat-panel.tsx` for UX parity; the Phase 3 transcript sheet for a consistent mount pattern.
2. Implement `sendChat` + `messages` accumulation in the hook (bounded array, echo-back for own
   messages).
   → verify: sending from mobile emits `conference.chat`; the sender sees their own message.
3. Build `chat-panel.tsx` (own messages aligned distinctly, sender `displayName`, `sentAt`, tokens
   - i18n only).
     → verify: a web peer's message arrives translated into the mobile user's language and renders.
4. Mount in the call view with a clear open/close affordance; keep Leave the single primary action.
   → verify: mobile→web and web→mobile chat both arrive already translated per recipient.

## Verification

- Mobile→web and web→mobile messages each arrive in the **recipient's** language; own messages
  echo in the sender's language.
- List + input render on `@chatofy/ui` tokens; placeholder/empty-state keys in en + vi.
- `token-parity.spec.ts` green; no second accent control on the call screen.

## Risk / rollback

- No server change needed — if a recipient's translation fails, that is an existing gateway
  behavior, not introduced here; surface it, do not patch the gateway in this plan.
- Rollback: additive; unmounting the panel + removing the hook's chat wiring leaves Phases 1–3
  (video + translation) fully working.
