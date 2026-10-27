---
title: 'Conference: Meet-style landing and pre-join room'
description: 'Landing with New meeting + code/link, a green room with media preview, prefilled name, language and translated-voice chip; clean share links; mobile voice parity.'
status: completed
priority: P1
effort: 3d
branch: quanganh208/feat/conference-prejoin
tags: [frontend, web, mobile, conference, ux]
blockedBy: []
blocks: []
created: 2026-10-27
---

# Conference: Meet-style landing and pre-join room

## Overview

The conference entry flow is one form that mixes "create" and "join", makes a
signed-in user type their name, carries `?name=&lang=` in the share link, and
hides the translated voice (it silently reuses `/translate`'s localStorage
settings on web, and the schema default on mobile). This plan rebuilds the entry
flow after Google Meet: a landing page, then a pre-join "green room" on the room
URL itself.

Handover contract: `--advice`. Every phase is decomposed into tasks with target
files, steps, success criteria and a mechanical Verify, and every phase file
carries a Failure Protocol. Stopping on a failed Verify is intended behaviour.

## Accepted decisions (do not reopen)

- Accounts only. No guest access, no host admit. A signed-out visitor opening a
  room link goes through `/login?next=…` (already done by `apps/web/proxy.ts`)
  and lands back on the room.
- Voice is shown in the green room as a chip; pressing it opens a popover that
  edits gender and speed **in place**, writing to the single existing store
  `chatofy.translate-settings` through `useTranslateSettings`. No second store,
  no DB column.
- The share link is the room URL only: `/conference/<roomId>`. Name and language
  travel in the `conference.join` payload, which the server already accepts.
- One accent-filled control per screen state; ≤2 elevated surfaces; shadcn
  components from `@chatofy/ui/react` only (`docs/design-guidelines.md`,
  `apps/web/src/design/accent-budget-app.spec.tsx`).

## Non-goals

Guest access, host admit/knock, a participant cap, video grid/layout changes, a
pre-join REST status check (the room detail endpoint is participant-gated, so a
first-time joiner learns "ended/not found" from the join reply, shown on the
same page), per-language voice picking in the green room, a voice column in the
database, mobile device pickers or mic meter.

## Phases

| #   | Phase                                                                                  | Depends on | Status    |
| --- | -------------------------------------------------------------------------------------- | ---------- | --------- |
| 1   | [Landing page and login return](./phase-01-landing-page-and-login-return.md)           | —          | Completed |
| 2   | [Media device plumbing and join-time options](./phase-02-media-device-plumbing.md)     | —          | Completed |
| 3   | [Web pre-join room](./phase-03-web-pre-join-room.md)                                   | 1, 2       | Completed |
| 4   | [Mobile translated-voice parity](./phase-04-mobile-voice-parity.md)                    | —          | Completed |
| 5   | [Verification in a real browser and docs](./phase-05-browser-verification-and-docs.md) | 1–4        | Completed |

Run the phases in order 1 → 2 → 3 → 4 → 5. Phase 4 touches only `apps/mobile`
and may run before phase 3 if needed.

## Success Criteria

- [x] A signed-in user reaches a call without typing their name (prefilled from the session, still editable).
- [x] `/conference/<roomId>` with no query string shows the pre-join room, never a bounce to the lobby.
- [x] A signed-out visitor opening the room link signs in and returns to the same room.
- [x] Pre-join room shows camera preview, a moving mic level meter, mic/camera toggles, device pickers, name, language, voice chip, and one filled "Join now".
- [x] Changing the voice in the chip changes what `/translate` shows, and vice versa.
- [x] In-call header has a "Copy invite link" control that copies `<origin>/conference/<roomId>`.
- [x] Mobile lobby has a voice gender control and the mobile speaker leg uses it.
- [x] `pnpm --filter web test`, `pnpm --filter web typecheck`, `pnpm --filter web lint`, `pnpm --filter mobile test`, `pnpm --filter mobile typecheck`, `pnpm --filter @chatofy/i18n test` all exit 0.
- [x] Screens checked at 1440×900, 768×1024, 375×812.
