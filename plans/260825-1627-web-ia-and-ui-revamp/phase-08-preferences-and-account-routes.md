---
title: 'Phase 8: Preferences and Account routes'
status: todo
priority: P1
dependencies: [7]
---

# Phase 8: Preferences and Account routes

## Overview

Add `/preferences` and `/account`. These are what take the sidebar from two destinations
to four — the change that answers counsel's objection to having a sidebar at all.

## Requirements

- [ ] `/preferences` renders the same `TranslateSettingsPanel` the translate popover uses
- [ ] `/account` shows identity and the sign-out control, moved off the chrome
- [ ] Both are session-gated by the existing matcher with no `proxy.ts` edit
- [ ] Neither duplicates a component

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

- [ ] `/preferences` and `/account` render in the app chrome and are session-gated
- [ ] Changing voice on `/preferences`, then opening the translate popover, shows the same value
- [ ] `git diff apps/web/proxy.ts` is empty
- [ ] `grep -rn "TranslateSettingsPanel" apps/web/src apps/web/app` shows one definition and exactly two import sites — `grep -c` cannot express this, it counts lines per file and matches the spec too
- [ ] Sign out from either place behaves identically
- [ ] No copy on `/account` claims sign-out-everywhere
- [ ] Both routes export `metadata`
- [ ] The sidebar now shows all four items and the build is green — proving no dead `href`
- [ ] `pnpm --filter web test`, `typecheck`, `build` green

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
