---
title: Conference pre-join shipped on branch
date: 2026-10-27
summary: Meet-style landing + pre-join room implemented and verified; review caught a stale-voice overwrite
---

# Conference pre-join shipped on branch

## What happened

Executed `plans/261027-0850-conference-meet-style-prejoin` on branch `quanganh208/feat/conference-prejoin` (uncommitted). Landing (New meeting + code/link), pre-join room (preview, mic meter, device pickers, prefilled name, language, voice chip), invite-link copy, mobile voice gender. All gates green: web 1270 tests, mobile 70, i18n 25; Playwright with two real local accounts 19/19.

## Bugs found on the way

- `use-conference.ts` sent `?callbackUrl=` to login, which reads `next`: mid-call expiry lost the room. Fixed.
- Code review: stage and voice chip each held a `useTranslateSettings()` instance; the stage's save on Join wrote its stale copy over a voice changed >200 ms earlier. One instance now, passed down; regression spec proven by mutation (fails with the bug reintroduced).
- Meter AudioContext closed twice (unhandled rejection) and may start suspended in a fresh tab; effect now owns it and resumes on first gesture.
- `leave()` reports `idle`, so the room gates the green room on `joinedAs` and renders nothing for the exit frame.

## Not re-verified in a browser

The four review fixes were checked by unit specs and gates only, not by a second Playwright run. The suspended-AudioContext case was not reproduced in real Chrome.

## Next steps

Commit and PR when the user asks; check CI on main after merge.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
