# Phase 3 — Web / extension UI

**State: open.**

The transcript lives client-side in `@chatofy/realtime-client`
(`turn-keyed-transcript.ts`, speaker roster + attributions), so the UI already
holds everything the request needs.

## Tasks

- [ ] `@chatofy/api-client` — add `generateMinutes(sessionId, turns, language?)`
      and `getMinutes(sessionId)` with runtime contract validation against
      `generateMinutesRequestSchema` / `minutesResponseSchema` (the package
      validates every call — do not bypass).
- [ ] Map the reducer's turns → `MinutesSourceTurn[]`: `speakerLabel` is the
      roster label the user confirmed (fall back to "Speaker 1/2"), `text` is the
      settled SOURCE-language line, in spoken order.
- [ ] `apps/web` — a "Minutes" panel on the translate surface: a Generate button
      (disabled until the conversation has ended), a loading state while the pass
      runs, and a rendered result (summary, key points, decisions, action items
      with owner/due-date chips). Reuse `@chatofy/ui` primitives; no new tokens.
- [ ] Copy-to-clipboard / export of the rendered minutes (markdown).
- [ ] i18n: every new string in `@chatofy/i18n`, en + vi, parity enforced by tsc.
- [ ] `apps/extension` — same panel in the meeting popup, sharing the
      realtime-client mapping (do not re-derive it per app; that is the extraction
      lesson recorded in `system-architecture.md`).

## Verify

Web + extension typecheck; a node test drives a canned conversation → mapping →
mocked client and asserts the rendered structure. Manual: run a real vi↔en
conversation, generate minutes, eyeball the four sections.
