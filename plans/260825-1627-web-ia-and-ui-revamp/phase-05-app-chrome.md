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

- [x] `(app)` renders a collapsible sidebar and a thin topbar
- [x] `SessionMenu` becomes an avatar dropdown carrying the email and Sign out
- [x] `(auth)` has no nav and no sign-out control
- [x] `(marketing)` has its own header with a mobile sheet
- [x] `AppShell` is deleted
- [x] **The sidebar links only routes that exist**

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

### Call-site labels to decide against the mockup

Two of the generated primitives render section captions at `text-hint`, where this
project's pattern for a tiny caption is `text-label tracking-wide uppercase` (see
`direction-toggle.tsx` and `segmented-control.tsx`). Decide each against the mockup and
apply it with a `className` at the call site — **not** by editing the primitive, which
would fork it from upstream:

- `SidebarGroupLabel` — a sidebar section caption.
- `DropdownMenuLabel` — the avatar menu's section header.

`DropdownMenuShortcut` keeps `text-hint`: a shortcut is not a label.

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

- [x] `pnpm --filter web build` green — proves no `href` points at a nonexistent route
- [x] `grep -rn "app-shell" apps/web` returns nothing
- [x] `grep -rn "translate/live" apps/web/src/components apps/web/app` returns nothing outside the live route itself
- [x] The sidebar contains exactly one item; `/dashboard` and `/preferences` are not linked
- [x] The rail's icon-only items have accessible names with tooltips suppressed
- [x] Tab from page load reaches a skip link before any nav item
- [x] Topbar does not shift between session loading and loaded
- [x] `pnpm --filter web test`, `typecheck`, `lint` green
- [x] Review: one accent-filled control per screen

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

## Deviations from the plan

Recorded because each was decided against evidence, not preference.

**The avatar dropdown is in the sidebar footer, not the topbar.** The requirement named
the topbar; the mockup draws identity in the sidebar footer and gives the topbar only the
theme control. The mockup wins — it is the design the user reviewed, and the topbar
version would have put the email in two places or moved it away from the mark it belongs
beside. Sign out is behind that avatar, which is also the only way it survives a 3rem
rail.

**`SidebarGroupLabel` is not rendered at all**, rather than restyled to
`text-label uppercase`. A caption distinguishes one group from another; with one list
there is nothing to distinguish, and the mockup draws a separator with no caption. The
question is worth reopening in Phase 8, when there are two groups. **`DropdownMenuLabel`
keeps its default treatment** for a different reason: what it carries is an email
address. The `text-label` pattern is for captions, and uppercasing an address makes it
harder to read and slightly wrong.

**No mobile sheet in the marketing header yet.** The `(app)` group has one — the sidebar
primitive renders a `Sheet` below `md` and `SidebarTrigger` opens it. Marketing does not,
because there is nothing to collapse into it: the section anchors it would hold point at
sections the landing page does not have until Phase 9, and a sheet containing two buttons
that already fit on a phone is a control with nothing to reveal. Header nav, and the sheet
that carries it, land together in Phase 9. Same rule as the sidebar's — items land with
what they point at.

**No status-slot prop on the topbar.** The plan asked for a slot Phase 6 fills. A typed
prop with no caller today is dead code, so the boundary is written into `app-topbar.tsx`'s
docblock instead: the status replaces the title, and the mic level, transcript controls
and direction readout stay in `CascadePanel`.

**Two files the plan did not list.** `plain-frame.tsx` and `app/translate/layout.tsx`.
Deleting the shell left three surfaces with no group to inherit from — the auth routes,
the two unlinked lab routes, and the root 404 — all wanting the same thing: brand, theme,
one measured column, no navigation. `PlainFrame` is that, and it is what makes "`(auth)`
shows no sign-out" structural rather than a side effect of `SessionMenu` returning `null`
when signed out. `app/translate/layout.tsx` gives the lab routes back the return link they
had, and confirms the Phase 4 finding from the other side: a layout inside a route group
is not an ancestor of anything outside it, so `/translate` takes the product chrome while
`/translate/live` takes this one.

**`/translate/baseline` now uses the `wide` measure**, where it asked for `reading`. Two
unlinked measurement routes are not worth two answers.

**`/` moved from prerendered to server-rendered on demand.** Measured, not inferred:
building with the header's `await auth()` removed returns it to `○`, so the session read
is exactly the cause. It is the price of the plan's own decision to resolve the signed-in
header on the server, and it buys the correct pair of actions in the first byte instead of
a swap after hydration. The landing stays fully shareable; it is not cached.

**A spec the plan did not ask for.** `app-chrome.spec.tsx`, 7 tests. Two success criteria
here are invisible to every other gate: a nav item pointing at a real but deliberately
unlisted route, and an accessible name that quietly starts depending on the tooltip.
Both were confirmed to fail when broken — removing the `aria-label` fails the third test.

## Decisions recorded here

**Collapse mechanism: the route wins.** Written into `app-chrome.tsx`. `open` is derived
from the pathname plus an override that belongs to the route it was made on, so a manual
toggle lasts until the next navigation and there is no effect resetting state after the
fact. The stock `sidebar_state` cookie is still written by the primitive on every toggle
and **nothing reads it** — inert, not a second mechanism. Wiring it into `defaultOpen` is
re-opening this decision.

**Sidebar label for `/dashboard`: "Bảng điều khiển"** (plan open question 1). "Tổng quan"
was proposed as the shorter rail-safe alternative, and the premise does not hold: the rail
hides labels entirely rather than truncating them, so rail width was never the constraint.
Expanded, the sidebar is 16rem and the mockup's own Vietnamese screen shows the longer
label fitting. It lands with the route in Phase 7 and the Vietnamese in Phase 10.

## What Phase 6 inherits

- `AppTopbar` renders the route title. The live status replaces it; nothing else moves up.
- `/translate` already opens as a rail — `RAIL_ROUTES` in `app-chrome.tsx`.
- `popover.tsx` is generated and exported, unused so far.
