---
title: 'Phase 4: Route groups, pure moves'
status: todo
priority: P1
dependencies: [3]
---

# Phase 4: Route groups, pure moves

## Overview

Create the three route groups and move every page into them, with layouts that reproduce
today's chrome exactly. **Nothing looks different when this phase lands.** That is the
entire point: the structural move is separated from the visual one so a review can check
"nothing changed" rather than "everything changed at once".

The new chrome arrives in Phase 5.

## Requirements

- [ ] `app/(marketing)/`, `app/(auth)/`, `app/(app)/` exist, each with a `layout.tsx`
- [ ] Every route renders at its unchanged address, looking exactly as before
- [ ] The measure values live in exactly one module
- [ ] `proxy.ts` needs no edit

## Architecture

### Day-one check, before moving anything

`app/(app)/translate/page.tsx` would coexist with `app/translate/live/`, which claims the
`translate` segment both inside and outside a route group. The resolved paths are
distinct, so this should be legal — but route-group segment collisions are exactly the
corner Next's router edge cases live in, and finding out late costs the whole phase.

**Verify with a throwaway build before the real moves.** If Next objects, the fallback is
a `(lab)` route group for `live` and `baseline`; URLs stay unchanged either way.

### File moves

```
app/page.tsx                → app/(marketing)/page.tsx            /
app/login/                  → app/(auth)/login/                   /login
app/register/               → app/(auth)/register/                /register
app/forgot-password/        → app/(auth)/forgot-password/         /forgot-password
app/reset-password/         → app/(auth)/reset-password/          /reset-password
app/verify-email/           → app/(auth)/verify-email/            /verify-email
app/translate/page.tsx      → app/(app)/translate/page.tsx        /translate
app/translate/live/         stays put                             /translate/live
app/translate/baseline/     stays put                             /translate/baseline
```

`live` and `baseline` stay outside `(app)`: they are experiments, and putting them inside
the product chrome would imply they are part of the product.

`@/` alias imports survive the move; relative imports do not. `app/login/page.tsx`'s
`@/../auth` is alias-relative to the app root and survives.

### The three layouts, in this phase only

Each reproduces the current `AppShell` output — brand, optional back link, `SessionMenu`,
theme toggle, and the same centered measure. Three near-identical files is the expected
intermediate state; Phase 5 is what makes them diverge.

`AppShell` is **not deleted here**. It stays until Phase 5 replaces what it does, so this
phase is a pure move with a working fallback.

### Measures

`AppShell`'s `MEASURE` map (`wide: max-w-2xl`, `reading: max-w-xl`) moves to
`src/components/layout/measures.ts` and gains `marketing: max-w-4xl` for Phase 9. Routes
ask for a name; they never write a width.

### Boundaries and metadata — verified gaps

`apps/web/app` today contains **no** `error.tsx`, `loading.tsx`, `not-found.tsx` or
`global-error.tsx`. A render error shows Next's default and a bad URL shows a bare 404.
This was tolerable while `/` was prerendered; after Phase 10 reads `cookies()` in the root
layout, every route is dynamic and can fail at request time.

Add per group:

- root `not-found.tsx`, and `(marketing)/error.tsx`
- `(auth)/error.tsx` — **must render no query-string value**, since these routes carry
  tokens in the URL
- `(app)/error.tsx` and `(app)/loading.tsx`

Metadata: the root layout and all five auth pages export `metadata` today; `/` and
`/translate` do not. Add `/translate`'s here. `/` gets one in Phase 9, and the routes
added in Phases 7–8 bring their own. Phase 10 makes them localized via
`generateMetadata`.

## Related Code Files

- Create: `apps/web/app/(marketing)/layout.tsx`, `app/(auth)/layout.tsx`, `app/(app)/layout.tsx`
- Create: `apps/web/src/components/layout/measures.ts`
- Create: `apps/web/app/not-found.tsx`, `app/(marketing)/error.tsx`, `app/(auth)/error.tsx`, `app/(app)/error.tsx`, `app/(app)/loading.tsx`
- Move: the 7 page directories above, with `git mv`
- Read only: `apps/web/proxy.ts`, `apps/web/src/components/layout/app-shell.tsx`

## Implementation Steps

1. Throwaway build proving `(app)/translate` and ungrouped `translate/live` coexist.
2. Create `measures.ts`.
3. Create the three group layouts reproducing current chrome.
4. `git mv` the seven directories.
5. Strip the per-page `<AppShell>` wrapper; the group layout supplies it.
6. Add the boundaries and `/translate` metadata.
7. Run tests, typecheck, lint, build.

## Success Criteria

- [ ] A build proves the `translate` segment coexistence before any move
- [ ] All 9 routes render at unchanged addresses — verified against a written route checklist, not assumed
- [ ] Visual review: no route looks different from before this phase
- [ ] `pnpm --filter web test` green, `login-page.spec.tsx` included
- [ ] `pnpm --filter web build` green
- [ ] `git diff apps/web/proxy.ts` is empty
- [ ] Signed out, `/dashboard` still 404s (it does not exist yet) and `/translate` still redirects to `/login?next=/translate`
- [ ] A forced throw on an app route renders the group error boundary
- [ ] `(auth)/error.tsx` renders no query value — verified with a forced throw on `/verify-email?token=abc`

## Risk Assessment

**Route-group segment collision.** Signal: the step-1 build fails. Response: the `(lab)`
group fallback; do not proceed with moves until this is settled.

**A moved auth route breaks the token flow.** `/verify-email?token=…` is reached with no
session and the matcher exempts it by name. A route group does not change the path, so
the exemption still matches. Signal: `proxy.ts` needing any edit. Response: stop — if the
matcher needs changing, a URL moved and that was not the plan.

**Nested `<html>`.** Signal: React warning about nested html/body, or the pre-paint theme
script running twice. Response: only the root `app/layout.tsx` renders `<html>`/`<body>`;
group layouts return fragments. The theme script and `AppSessionProvider` stay in root,
untouched.

**"Nothing looks different" is asserted rather than checked.** Signal: a spacing or
measure change slipping in under cover of a structural phase. Response: this phase's whole
value is that the review question is trivial. If a visual change is tempting, it belongs in
Phase 5.
