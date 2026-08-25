---
title: 'Phase 7: Dashboard hub'
status: todo
priority: P1
dependencies: [6]
---

# Phase 7: Dashboard hub

## Overview

Add `/dashboard` — the post-login home — and make it the default destination after
sign-in. It shows only state that actually exists.

## Requirements

- [ ] `/dashboard` exists, requires a session, and renders in the app chrome
- [ ] Everything on it reflects real state; nothing is placeholder
- [ ] `DEFAULT_NEXT` points at it; an explicit `?next=` still wins
- [ ] No stat tiles, no "0 conversations", no charts

## Architecture

### The boundary that matters most in this plan

There is no conversation history, no usage metering, and no session persistence — the
schema has exactly one model, `User`. A dashboard that shows numbers here would be
inventing them, which the project rules forbid outright and which would undercut the
landing's own privacy claim.

**What the hub may show, all of it real:**

| Card                                                             | Source                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------- |
| Start a conversation — `DirectionToggle` + the primary CTA       | `chatofy.translate-settings` via `useTranslateSettings` |
| Readiness — microphone permission, translation service reachable | Permissions API; `GET /health`                          |
| Where else Chatofy runs — extension, mobile                      | static, and true                                        |

**What it may not show:** anything counted, charted, or timed.

### Why direction only

Settings live in the translate popover (Phase 4) and at `/preferences` (Phase 6). A
third full copy on the hub would be three places editing one storage key. Direction is
the one choice worth making before entering a conversation, so the hub keeps
`DirectionToggle` and the start button and nothing else from the settings set.

`DirectionToggle` is the real component: two readout boxes and a round 34px swap button
carrying `ArrowLeftRight`. Not a segmented control, and no text arrow.

### The hook, again

The hub reads and writes the same settings object, so it is a second
`useTranslateSettings` call site — in a _different route_, which is safe (the two pages
never mount together) but worth stating, because Phase 4's rule is "one call site per
page", not "one in the app".

### Redirect

`DEFAULT_NEXT` in `src/lib/same-origin-path.ts` changes `/translate` → `/dashboard`.
That constant is the fallback only; `sameOriginPath` still honours a validated `?next=`,
and its open-redirect hardening is untouched. Two consumers: `login-form.tsx` and
`google-button.tsx`; neither needs an edit.

`proxy.ts` needs no edit — `/dashboard` is not on the exemption list, so it is gated.

## Related Code Files

- Create: `apps/web/app/(app)/dashboard/page.tsx`
- Create: `apps/web/src/components/dashboard/start-conversation-card.tsx`, `readiness-card.tsx`, `surfaces-card.tsx`
- Create: `apps/web/src/hooks/use-microphone-permission.ts`
- Modify: `apps/web/src/lib/same-origin-path.ts` — `DEFAULT_NEXT`
- Modify: `apps/web/src/lib/same-origin-path.spec.ts` — it asserts the default
- Modify: `apps/web/src/components/layout/app-sidebar.tsx` — **add** the Dashboard item; it could not exist before this route did, under `typedRoutes`
- Read only: `apps/web/proxy.ts`

## Implementation Steps

1. Create the route and its three cards.
2. `use-microphone-permission.ts` — `navigator.permissions.query({name:'microphone'})`,
   with a graceful unknown state where the API is unavailable (it is not universal).
   An unknown state renders as unknown, never as granted.
3. Readiness pings `GET /health` through the existing api client.
4. Change `DEFAULT_NEXT` and update its spec.
5. Wire the CTA to `/translate`, carrying nothing — the settings are already persisted.
6. Run tests, typecheck, build.

## Success Criteria

- [ ] Signing in with no `?next=` lands on `/dashboard`
- [ ] Signing in from `/login?next=/preferences` still lands on `/preferences`
- [ ] Signed out, `/dashboard` redirects to `/login?next=/dashboard`
- [ ] `pnpm --filter web test` green, `same-origin-path.spec.ts` included
- [ ] Denying microphone permission shows a denied state, not a granted one
- [ ] Stopping the api shows the service as unreachable rather than silently "ready"
- [ ] Review: no element on the page displays a count, a duration, or a chart
- [ ] Review: exactly one accent-filled control on the page
- [ ] The sidebar now shows Dashboard and Translate, and still not Preferences or Account
- [ ] `/dashboard` exports `metadata`

## Risk Assessment

**The hub grows a metrics card.** Signal: any count, chart, or "recent activity" list in
review. Response: reject. This is the named single biggest failure mode of the plan and
nothing mechanical catches it.

**Readiness lies when it cannot tell.** The Permissions API does not answer for
microphone in every browser, and a hook that defaults to "granted" produces a card
claiming readiness it never checked. Signal: the card shows granted in a browser where
the query throws. Response: three states — granted, denied, unknown — and unknown is
rendered honestly.

**`GET /health` on every dashboard mount adds a request per navigation.** Low stakes
here, but signal: the endpoint appearing in latency traces. Response: it is a cheap
liveness check and the page is not hot; revisit only if it shows up.
