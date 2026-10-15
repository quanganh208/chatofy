# Phase 4 — In-meeting chat (mobile RN conference)

Report date: 2026-10-15 17:57 Asia/Bangkok
Branch: `video-conferencing` (no branch/switch)
Plan: `plans/261014-2230-conference-mobile-rn/phase-04-in-meeting-chat.md`

## Outcome

Native in-meeting chat with per-recipient translation wired into the mobile call
view at parity with web. Translation is entirely server-side; the client only
sends `conference.chat { text }` and renders received `ConferenceChatMessage`
(already in this client's language). All four static gates green. Runtime device
verification not possible in this environment — static checks are the gate.

## Files modified / created

- MODIFY `apps/mobile/src/conference/use-conference-native.ts`
  - Added `CHAT_MESSAGE_CAP = 200` (same as web).
  - Added `messages` state (`ConferenceChatMessage[]`).
  - Added a `conference.chat.message` branch in the inbound message listener:
    drops `error` payloads, appends bounded to the cap — ported verbatim from
    web `use-conference.ts` lines 812–821.
  - Implemented `sendChat(text)` → no-op on blank/whitespace or closed socket,
    else `send(ws, 'conference.chat', { text })` — ported from web lines 1026–1031.
  - Clears `messages` in `leave()` so a fresh join starts empty (ephemeral per
    meeting). Reconnect does not clear, matching web (only a fresh join resets).
  - Return now exposes real `messages` + `sendChat`; updated the two stub
    doc-comments on the contract interface. Public surface is additive-only.
- CREATE `apps/mobile/src/components/conference/chat-panel.tsx`
  - Modal bottom-sheet (reuses the Phase 3 transcript-sheet mount pattern):
    scrollable message list (newest last) + `TextInput` composer + ghost/outline
    Send + ghost Close. Own vs others distinguished by `mySocketId` (own renders
    `displayName •`, same convention as web `chat-panel.tsx`). Tokens only
    (`space/radius/fontSize/fontWeight` + theme `colors`); no accent fill, no
    hardcoded colors/strings. Imports `ConferenceChatMessage` from
    `@chatofy/types/events` (not redefined).
- MODIFY `apps/mobile/app/(app)/conference/[roomId].tsx`
  - Destructures `mySocketId`, `messages`, `sendChat` from the hook.
  - Added `chatVisible` state and a "Show chat" toggle beside the transcript
    toggle (both in a new `sheetButtons` row; the old single-button styles were
    generalized to `sheetButton`/`sheetButtonText`). Mounts `<ChatPanel>`.
  - Leave stays the single accent (`colors.primary`) control on the screen.
- MODIFY `packages/i18n/src/en.ts` + `packages/i18n/src/vi.ts`
  - Added matching keys in both files: `mobile.conference.chat`, `.showChat`,
    `.hideChat`, `.chatPlaceholder`, `.chatSend`, `.chatEmpty`.

## Verification (executed; real results)

1. `pnpm --filter @chatofy/i18n build` → **EXIT=0** (tsup build success, dts ok).
2. `pnpm --filter mobile exec tsc --noEmit` → **EXIT=0**, 0 errors.
3. `pnpm --filter mobile run lint` → **EXIT=0** (expo lint clean).
4. `pnpm --filter web exec vitest run src/design/token-parity.spec.ts`
   → **EXIT=0**, 179/179 tests passed.

i18n build was run before typecheck per the constraint (mobile `tsc` resolves
`@chatofy/i18n` types from the freshly built `dist`).

## Notes / design decisions

- `messages` cleared only on `leave()`, not on reconnect — a mid-call drop keeps
  prior messages, a fresh join starts clean. Matches web's reset-on-fresh-join
  semantics.
- No server, web, or native-dep changes. A failed per-recipient translation is
  existing gateway behavior; surfaced via the `error` drop (same as web), not
  patched here.

## Unresolved questions

None.
