---
title: 'Phase 7: Dashboard hub'
status: done
priority: P1
dependencies: [6]
---

# Phase 7: Dashboard hub

## Overview

Add `/dashboard` — the post-login home — and make it the default destination after
sign-in. It shows only state that actually exists.

## Requirements

- [x] `/dashboard` exists, requires a session, and renders in the app chrome
- [x] Everything on it reflects real state; nothing is placeholder
- [x] `DEFAULT_NEXT` points at it; an explicit `?next=` still wins
- [x] No stat tiles, no "0 conversations", no charts

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

- [x] Signing in with no `?next=` lands on `/dashboard`
- [x] Signing in from `/login?next=/preferences` still lands on `/preferences`
- [x] Signed out, `/dashboard` redirects to `/login?next=/dashboard`
- [x] `pnpm --filter web test` green, `same-origin-path.spec.ts` included
- [x] Denying microphone permission shows a denied state, not a granted one
- [x] Stopping the api shows the service as unreachable rather than silently "ready"
- [x] Review: no element on the page displays a count, a duration, or a chart
- [x] Review: exactly one accent-filled control on the page
- [x] The sidebar now shows Dashboard and Translate, and still not Preferences or Account
- [x] `/dashboard` exports `metadata`

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

## Deviations from the plan

**Four microphone states, not three.** The plan named granted, denied, unknown. The
Permissions API also answers `prompt`, which means the browser knows nothing has been
decided — starting a conversation will show the permission sheet. Folding that into
`unknown` would be the same dishonesty this card guards against, pointed the other way:
`unknown` means the query could not be made at all, and the two have different answers
to "what happens if I press Start". They render as "Not asked yet" and "Cannot tell".

**`checkHealth` is a bare `fetch`, not `apiFetch`.** `TransformInterceptor` skips
`/health*` so probe consumers get a stable raw body — verified against the running api,
which returns `{"status":"ok","time":…}` unenveloped. The enveloped client would have
rejected every successful response, and the card would have reported the service
unreachable while it was serving fine. It carries a 5s timeout, because a dead host
otherwise leaves "Checking…" on screen until the browser gives up.

**No install buttons on the surfaces card.** The mockup draws "Install" and "View".
`apps/extension` and `apps/mobile` are both real, and neither is published — the
extension is load-unpacked, the mobile app an Expo dev build. A button whose destination
does not exist is exactly the placeholder this phase forbids, so each row says what the
surface does and that it is not released. The buttons land when there is somewhere for
them to land.

**The start hint does not mention Preferences.** The mockup's copy reads "…or in
Preferences". `/preferences` arrives in Phase 8, so the sentence stops at "while
translating" until it is true. Same rule as the nav items.

**Two files the plan did not list.** `card-eyebrow.tsx`, because three cards render the
same caption pattern; and `readiness-row.tsx`, because the readiness pill is not
`StatusIndicator`. That component answers "what is the session doing" — `live`,
`speaking`, `busy`, `idle` — and there is no honest mapping from a granted permission
onto any of them. What they genuinely share is `Badge`, and both take it from there.

**A spec the plan left to review.** The Risk Assessment calls a metrics card the single
biggest failure mode of the whole plan and says nothing mechanical catches it.
`app/(app)/dashboard/page.spec.tsx` does: the rendered hub must contain **no digit at
all**. It is crude on purpose — a stat tile cannot arrive without one, and widening it
for a legitimate string is a change someone has to make deliberately. The same file
pins the one-accent-control rule, both readiness failure paths, and live revocation.

**happy-dom answers `granted` for every permission query**, which is the wrong default
to test against — a hook that never queried would have passed. Every permission case in
the spec states what the browser said.

## Verification

`pnpm --filter web test` 403/403 (21 files, from 396/20), `typecheck` clean,
`eslint src app` 0 errors and the 3 pre-existing warnings, `pnpm --filter web build`
green — `/dashboard` prerenders as static. `git diff apps/web/proxy.ts` empty.

Signed out, against a running dev server: `GET /dashboard` → `307` →
`/login?next=%2Fdashboard`. `GET /health` on the running api → `200`
`{"status":"ok","time":…}`, which is the raw shape `checkHealth` parses.

The two sign-in criteria are verified at the unit level, not by a live sign-in: both
consumers (`login-form.tsx`, `google-button.tsx`) call `sameOriginPath` and nothing
else, `DEFAULT_NEXT` is now pinned to `/dashboard` by an assertion, and a validated
nested path is returned unchanged by the existing cases. `/preferences` does not exist
until Phase 8, so that half could not be walked end to end even by hand.

Sidebar now lists `/dashboard` and `/translate` and still not `/preferences` or
`/account` — asserted in `app-chrome.spec.tsx`, which fails if either arrives early.

## What Phase 8 inherits

- `NAV_ITEMS` has two entries. Phase 8 adds two more plus the separator, and that is
  when the `SidebarGroupLabel` question from Phase 5 is worth reopening.
- `CardEyebrow` and `ReadinessRow` are the hub's two shared pieces.
- The start hint gains "…or in Preferences" once that route exists.
- `TranslateSettingsPanel` returns bare rows, so the Preferences page supplies a `Card`.
