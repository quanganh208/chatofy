---
title: Conference Meet-style pre-join plan
date: 2026-10-27
summary: Planned landing + green room for conference; accounts only; review caught four traps
---

# Conference Meet-style pre-join plan

## What happened

User found the conference entry flow weak: signed-in users retype their name, the share link carries `?name=&lang=`, and the translated voice is invisible (web silently reuses `/translate` localStorage settings; mobile always uses the schema default). Guests cannot join at all (WS bearer token, `ConferenceParticipant.userId` NOT NULL).

Plan: `plans/261027-0850-conference-meet-style-prejoin/` (5 phases, `--advice` handover format).

## Decision

- Accounts only; signed-out link visitors go through `/login?next=` (already handled by `apps/web/proxy.ts`).
- Landing = New meeting + code/link. Green room on `/conference/<roomId>`: preview, mic meter, toggles, device pickers, name prefilled from session, language, voice chip editing gender+speed in `chatofy.translate-settings`.
- Name/lang move to the join payload; share link is the bare room URL.

## Traps found in review (kongming)

- `ConferenceConnection.leave()` sets status back to `idle`; the green room must gate on `status === 'idle' && joinedAs === null` or it re-mounts and reopens the camera on Leave.
- happy-dom has no `navigator.mediaDevices` or `AudioContext`; stub with `Object.defineProperty`.
- `Conference.ownerId` / `ConferenceParticipant.userId` have no FK to `User`; test cleanup must delete rooms before users.
- `use-conference.ts` `redirectToLogin` sent `?callbackUrl=`, but the login form reads `next` — mid-call session expiry lost the room. Fixed in phase 1.

## Next steps

`/ak:cook plans/261027-0850-conference-meet-style-prejoin/plan.md --advice`

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
