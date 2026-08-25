---
title: 'Phase 8: Preferences and Account routes'
status: done
priority: P1
dependencies: [7]
---

# Phase 8: Preferences and Account routes

## Overview

Add `/preferences` and `/account`. These are what take the sidebar from two destinations
to four — the change that answers counsel's objection to having a sidebar at all.

## Requirements

- [x] `/preferences` renders the same `TranslateSettingsPanel` the translate popover uses
- [x] `/account` shows identity and the sign-out control, moved off the chrome
- [x] Both are session-gated by the existing matcher with no `proxy.ts` edit
- [x] Neither duplicates a component

## Architecture

### `/preferences`

Two cards:

1. **Conversation** — `TranslateSettingsPanel`, wrapped in `Card` by this page (Phase 4
   made the panel supply no surface of its own). `running={false}` here: nothing is
   live on this route, so direction and voice are editable, which is precisely what the
   popover cannot offer mid-conversation. That is the honest distinction between the two
   mounts — not "defaults vs live", which the single storage key does not support.
2. **Interface** — the language switcher and the theme choice. The switcher is a stub in
   this phase and becomes real in Phase 8; render it disabled with a note rather than
   faking a second language.

`useTranslateSettings` is called here, once, in the page. Same rule as every other route.

### `/account`

Identity from the session and `GET /auth/me`: name, email, verified state. Actions:
change password (links to the existing reset flow), and Sign out.

The avatar dropdown in the topbar keeps its Sign out too — that is a shortcut to the
same action, not a second implementation. Both call the same handler.

**Do not overstate what signing out does.** `session-menu.tsx`'s docblock is explicit:
it discards the cookie, the Nest token stays valid until it expires, and only a
completed password reset revokes earlier tokens and closes open sockets. Copy on this
page must not imply sign-out-everywhere.

### Sidebar

Four items: Dashboard, Translate, separator, Preferences, Account. A fifth slot is
reserved for History at PDR milestone 6 — reserved by leaving room, not by rendering a
disabled item.

## Related Code Files

- Create: `apps/web/app/(app)/preferences/page.tsx`, `app/(app)/account/page.tsx`
- Create: `apps/web/src/components/account/account-card.tsx`
- Modify: `apps/web/src/components/layout/app-sidebar.tsx` — **add** the separator plus both items; `typedRoutes` rejected them until these routes existed
- Modify: `apps/web/src/components/layout/session-menu.tsx` — share the sign-out handler
- Read only: `apps/web/src/components/translate/translate-settings-panel.tsx`
- Read only: `apps/web/src/clients/api-client.ts`

## Implementation Steps

1. Create `/preferences`, mounting `TranslateSettingsPanel` inside a `Card` with
   `running={false}`.
2. Add the Interface card with the theme control. **Omit the language row entirely** —
   the switcher is real in Phase 10, and an absent control explains itself better than a
   dead one.
3. Create `/account` reading identity from the session and `GET /auth/me`.
4. Extract the sign-out handler so the topbar dropdown and the account page share it.
5. Add both to the sidebar with correct active states.
6. Run tests, typecheck, build.

## Success Criteria

- [x] `/preferences` and `/account` render in the app chrome and are session-gated
- [x] Changing voice on `/preferences`, then opening the translate popover, shows the same value
- [x] `git diff apps/web/proxy.ts` is empty
- [x] `grep -rn "TranslateSettingsPanel" apps/web/src apps/web/app` shows one definition and exactly two import sites — `grep -c` cannot express this, it counts lines per file and matches the spec too
- [x] Sign out from either place behaves identically
- [x] No copy on `/account` claims sign-out-everywhere
- [x] Both routes export `metadata`
- [x] The sidebar now shows all four items and the build is green — proving no dead `href`
- [x] `pnpm --filter web test`, `typecheck`, `build` green

## Risk Assessment

**`/preferences` and the popover drift into two components.** Signal: a second file with
the same controls. Response: they are one component in two mounts; a change wanted in
one is wanted in both, and if it genuinely is not, that is a props question.

**Two `useTranslateSettings` mounts race on one storage key.** They are separate routes
and never mount together, so this is safe — but a future layout that renders a settings
summary in the sidebar would break it silently. Signal: settings that stop applying.
Response: keep the call in pages only, never in a layout or the chrome.

**A disabled language switcher reads as broken.** Signal: it looks like a bug in review.
Response: prefer omitting the Interface card's language row entirely until Phase 8 —
an absent control explains itself better than a dead one.

## Deviations from the plan

**`use-auth-recovery.ts` was pulled into the extraction too.** The plan named the topbar
dropdown and the account page. That hook had its own `signOut({ redirectTo: '/login' })`
twice — the same call, the same destination, and the third way a user actually leaves the
app. Extracting two of three call sites and leaving one duplicating the string is the DRY
violation the extraction exists to fix, and the sentence about what signing out does not
do would still have had two homes.

**`SidebarGroupLabel` stays unrendered**, which is the Phase 5 question reopened at the
moment the plan said to reopen it. Two groups exist now, and the answer did not change:
two captions over four self-describing items are words the reader skips, and the rail
hides captions while keeping the separator — so the separator is what carries the
grouping in both states. The mockup draws it that way.

**No verified badge on `/account`.** The plan's prose names "verified state". There is no
field to read, and `registration.service.ts` says why in as many words: the row is created
by redeeming the verification link, so **no `emailVerified` column exists**. Google's path
attests the same thing. A pill that can never say anything but "Verified" looks like a
check that could fail, which is a worse lie than saying nothing. What the card shows
instead is `createdAt`, formatted through `Intl` in the reader's own locale.

**Identity comes from the session first, `GET /auth/me` second.** The cookie already
carries name and email, so those paint immediately and the round trip only adds
`createdAt`. A failed lookup reports itself and does NOT sign anyone out — acting on a 401
belongs to `use-auth-recovery.ts`, which the socket and HTTP paths already run, and a page
that ejected people on any probe failure would eject them on a flaky connection.

**`getMe` goes through the enveloped client**, unlike Phase 7's `checkHealth`. The
difference is real: `/auth/me` is wrapped by `TransformInterceptor` and guarded, so it
needs both the envelope and the bearer header; `/health*` is exempt from the envelope and
public.

**Three files the plan did not list.** `interface-preferences-card.tsx` and
`conversation-preferences-card.tsx`, so `/preferences` stays a server component that can
export `metadata` while each card reads what only a browser knows; and `sign-out.ts`,
which the plan asked for as an extraction without naming a home.

**Two specs the plan left to review.** `sign-out.spec.ts` scans `src/` and `app/` and
requires that exactly one file imports `signOut` from `next-auth/react` — the failure it
catches is a fourth caller written with no `redirectTo`, which lands on `/` while every
other path lands on `/login` and is visible to nobody. `account-card.spec.tsx` bans the
phrasing "all devices / everywhere / every device / all sessions" from the rendered page
and requires the accurate sentence to be present, because that copy is a security claim
and the failure arrives as an edit that sounded stronger.

## Verification

`pnpm --filter web test` 408/408 (23 files, from 403/21), `typecheck` clean,
`eslint src app` 0 errors and the 3 pre-existing warnings, `pnpm --filter web build`
green — both routes prerender. `git diff apps/web/proxy.ts` empty.

Signed out, against a running dev server: `/preferences` → 307 → `/login?next=%2Fpreferences`,
`/account` → 307 → `/login?next=%2Faccount`, `/dashboard` → 307 → `/login?next=%2Fdashboard`.

`grep -rn "TranslateSettingsPanel" src app` (excluding specs) → one definition and exactly
two import sites: the popover and the preferences card.

The shared-storage criterion is structural rather than tested: both mounts are the same
component reading one key through `useTranslateSettings`, and there is no second key for
them to disagree through.

## What Phase 9 inherits

- The sidebar is complete at four items. The next one is History at PDR milestone 6.
- `CardEyebrow` is now used by the dashboard and both preferences cards.
- The Interface card has a language row shaped for it and deliberately empty. Phase 10
  fills it.
- `signOutOfChatofy` is the only way out; adding a caller means calling it.
