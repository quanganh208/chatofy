---
title: 'Phase 5: App chrome'
status: todo
priority: P1
dependencies: [4]
---

# Phase 5: App chrome

## Overview

Give each route group its real chrome: a sidebar and topbar for `(app)`, a marketing
header for `(marketing)`, an auth card frame for `(auth)`. Retire `AppShell`.

This is where the app stops looking like it did. Phase 4 made that reviewable by moving
everything first.

## Requirements

- [ ] `(app)` renders a collapsible sidebar and a thin topbar
- [ ] `SessionMenu` becomes an avatar dropdown carrying the email and Sign out
- [ ] `(auth)` has no nav and no sign-out control
- [ ] `(marketing)` has its own header with a mobile sheet
- [ ] `AppShell` is deleted
- [ ] **The sidebar links only routes that exist**

## Architecture

### Nav items land with their routes

`typedRoutes: true` rejects an `href` to a nonexistent route **at build**. `/dashboard`
arrives in Phase 7 and `/preferences`/`/account` in Phase 8, so a sidebar listing all
four here cannot build — and even untyped it would ship dead links, breaking the rule
that every phase leaves the app shippable.

So the sidebar ships incrementally:

| Phase | Sidebar contains                  |
| ----- | --------------------------------- |
| 5     | Translate                         |
| 7     | + Dashboard                       |
| 8     | + separator, Preferences, Account |

Stub pages would also satisfy the compiler, but a placeholder route contradicts this
plan's own rule against shipping things that are not real.

### The sidebar

`sidebar.tsx` from Phase 2. Brand, the nav list, and a footer with the avatar and
identity. Icon rail at `md`, `Sheet` on mobile.

**Decide the collapse mechanism here, once.** The stock shadcn sidebar persists its
open state in a cookie via `SidebarProvider`'s `defaultOpen`. Phase 6 wants
`/translate` to default to the rail while `/dashboard` defaults to expanded — a
route-driven default, which fights user-persisted state. Pick one and write it down:

- _Route-driven wins:_ the route sets the state on navigation; the user's manual toggle
  applies only until they navigate. Simple, predictable, and matches the design intent
  that translate is a focus surface.
- _User-persisted wins:_ the cookie is authoritative and `/translate` only sets the
  initial value on first visit.

Recommended: **route-driven**, because the reason `/translate` collapses is the surface's
need, not a preference. Record it in a docblock either way — two mechanisms silently
disagreeing is the failure mode.

Accessibility: the sidebar is navigation, so it needs a landmark and an accessible name,
and the rail's icon-only items need accessible labels (`Tooltip` from Phase 2 supplies
the visible affordance; the accessible name must not depend on the tooltip). A skip link
to `<main>` belongs here too — with a persistent sidebar, keyboard users otherwise tab
through the whole nav on every page.

### The topbar

Page title, a slot Phase 6 fills with surface status, theme toggle, and the avatar
`DropdownMenu` replacing today's bare email string plus a Sign out button.

`SessionMenu` currently returns `null` while loading. That was fine for a text span and
will shift the topbar when it is an avatar — render a `Skeleton` at the avatar's size
instead.

The session carries **no avatar image** (verified in `apps/web/auth.ts`), so the avatar is
initials. Worth recording: wiring Google's `picture` later would silently fail on the
CSP's `img-src 'self'` in `next.config.ts`.

**The nav must never link `/translate/live`.** It is deliberately unlinked.

### Marketing and auth

`(marketing)` — sticky header, transparent over the hero: brand, anchor nav, theme
toggle, ghost "Sign in", one accent CTA, and a `Sheet` on mobile. Signed-in visitors get a
single "Open Chatofy" instead of the pair; read the session server-side. **Do not redirect
`/` in middleware** — the landing must stay shareable and it opens the thesis demo.

`(auth)` — brand, centered card, a link home. No nav, no session menu, no sign-out. Today
that holds only because `SessionMenu` renders nothing when signed out; this makes it
structural.

## Related Code Files

- Create: `apps/web/src/components/layout/app-sidebar.tsx`, `app-topbar.tsx`, `marketing-header.tsx`, `skip-link.tsx`
- Modify: `apps/web/src/components/layout/session-menu.tsx` — avatar dropdown
- Modify: `apps/web/app/(app)/layout.tsx`, `app/(marketing)/layout.tsx`, `app/(auth)/layout.tsx`
- Delete: `apps/web/src/components/layout/app-shell.tsx`
- Read only: `apps/web/auth.ts`, `apps/web/next.config.ts`

## Implementation Steps

1. Build the sidebar with **Translate only**, plus the collapse-mechanism decision in a docblock.
2. Build the topbar with its status slot and the avatar dropdown; `Skeleton` while loading.
3. Add the skip link and the nav landmark.
4. Replace `(marketing)` and `(auth)` layouts with their real chrome.
5. Delete `app-shell.tsx`.
6. Keyboard pass: tab from page load; the skip link must be the first stop.
7. Run tests, typecheck, lint, build.

## Success Criteria

- [ ] `pnpm --filter web build` green — proves no `href` points at a nonexistent route
- [ ] `grep -rn "app-shell" apps/web` returns nothing
- [ ] `grep -rn "translate/live" apps/web/src/components apps/web/app` returns nothing outside the live route itself
- [ ] The sidebar contains exactly one item; `/dashboard` and `/preferences` are not linked
- [ ] The rail's icon-only items have accessible names with tooltips suppressed
- [ ] Tab from page load reaches a skip link before any nav item
- [ ] Topbar does not shift between session loading and loaded
- [ ] `pnpm --filter web test`, `typecheck`, `lint` green
- [ ] Review: one accent-filled control per screen

## Risk Assessment

**Dead nav links.** The defect that split this phase off Phase 4 in the first place.
Signal: the build fails, or a nav item 404s. Response: items land with their routes; the
table above is the schedule.

**Two collapse mechanisms disagree.** Signal: navigating to `/translate` collapses the
rail, but returning to another route leaves it collapsed against the user's toggle — or
the reverse. Response: the decision is made in this phase and recorded in a docblock, not
discovered in Phase 6.

**The rail is unusable without a mouse.** Icon-only nav whose only label is a hover
tooltip is invisible to a screen reader and to keyboard users. Signal: the accessible-name
criterion above. Response: `aria-label` on the item; the tooltip is decoration.

**Chrome creep onto the translate surface.** Signal: status, mic level or transcript
controls migrating into the topbar because there is now room. Response: the topbar gets a
_slot_; what fills it is Phase 6's decision, and `CascadePanel` keeps what it owns.
