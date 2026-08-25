---
title: 'Web IA and UI revamp'
description: 'Restructure apps/web into landing → dashboard → translate with three chromes, a sidebar shell, and bilingual VI/EN.'
status: pending
priority: P1
effort: ''
tags: [web, ui, ia, i18n]
created: 2026-08-25
blockedBy: []
blocks: []
phases: 12
---

# Web IA and UI revamp

## Overview

`apps/web` is one thin header repeated across every route, a `/` that is barely an
entry point, and a `/translate` whose settings panel permanently competes with the
transcript it sits beside. This plan restructures it into three chromes — a public
marketing landing, an auth chrome, and an app shell with a left sidebar — adds a
post-login hub at `/dashboard`, moves translate settings behind a popover, and makes
the whole surface bilingual VI/EN.

Source: `plans/reports/brainstorm-260825-1531-web-ia-ui-revamp.md`. The interface is
previewed in `./mockup.html` (five screens, both themes, both languages, deep-linkable),
with rendered stills as `shot-*.png`.

**No URL moves.** The three chromes are Next.js route groups, which do not appear in
the path. Only `DEFAULT_NEXT` changes address.

```
app/(marketing)/  →  /                          landing, public
app/(auth)/       →  /login /register /…        5 routes, public
app/(app)/        →  /dashboard /translate      protected by the existing matcher
                     /preferences /account
app/translate/live | baseline                   untouched, deliberately unlinked
```

## Goals

| #   | Goal                                                                              | Priority |
| --- | --------------------------------------------------------------------------------- | -------- |
| 1   | `/` is a full marketing landing with its own chrome                               | P1       |
| 2   | A post-login hub at `/dashboard` showing only real state — no invented metrics    | P1       |
| 3   | Left sidebar + thin topbar replace the current header across app routes           | P1       |
| 4   | Translate settings move behind a popover so the translation dominates its surface | P1       |
| 5   | Every web surface is available in Vietnamese and English with a switcher          | P1       |
| 6   | Auth emails follow the user's language                                            | P2       |
| 7   | No palette hex changes; the extension, overlay and mobile are unaffected          | P1       |

## Constraints

- **Test-enforced design system.** `packages/ui/src/react/skin-guard.spec.ts` bans
  `dark:`, `bg-accent`, `text-accent-foreground`, `bg-popover`,
  `text-popover-foreground`, `border-input`, `text-sm`/`text-xs`, and the
  `@/lib/utils` alias. `apps/web/src/design/app-skin-guard.spec.ts` bans every
  size-name utility in app code. `token-parity.spec.ts` asserts a hand-written
  mapping in **both directions** against **both** `apps/web/app/globals.css` and
  `apps/extension/entrypoints/popup/theme.css`. `contrast-floors.spec.ts` measures
  token pairs.
- **Everything web renders is shadcn or composed only from shadcn.** CLI-generated,
  then re-skinned per `docs/design-guidelines.md` § Re-skinning a generated component.
- **One accent-filled control per screen.** No test enforces this for app screens;
  Phase 9 adds per-section render specs for the marketing page, where sprawl actually
  happens. It is the specific regression a "make it prettier" pass invites.
- **No opacity-modified primary fill.** `hover:bg-primary/90` fades a filled button on a
  dark ground and reads as disabled. Phase 2 turns this into a `bg-primary/\d` row in
  both skin guards — and it already catches a live violation in `badge.tsx`.
- **Motion never in the way of reading a translation.** Every `transition-*` /
  `animate-*` carries a `motion-reduce:` escape; the CLI writes neither.
- `typedRoutes: true` in `next.config.ts`.
- `proxy.ts` needs no edit: its matcher exempts only `/` and the five auth routes, so
  every new route under `(app)` is protected by construction.

## Non-goals

- Conversation history. The PDR lists it in MVP; nothing implements it and the tables
  were dropped in the migration squash. It is the only thing that would make the hub a
  real data dashboard, and it is a backend delivery. Deferred to PDR milestone 6.
- Any palette hex change. Every value is contrast-measured and consumed by four
  surfaces.
- `/translate/live` and `/translate/baseline` behaviour. They stay reachable by URL and
  deliberately unlinked. **Nothing in the new nav may link `/translate/live`.**
- The extension popup, the meeting overlay, and mobile. They may adopt `packages/i18n`
  later; this plan does not move them.
- Sweeping the 32 remaining Tailwind size utilities in web. Recorded as half-closed in
  the guidelines; its own change.

## Phases

| #   | Phase                                                                                                   | Status  |
| --- | ------------------------------------------------------------------------------------------------------- | ------- |
| 1   | [Phase 1: Design tokens and parity](./phase-01-design-tokens-and-parity.md)                             | Done    |
| 2   | [Phase 2: shadcn primitives](./phase-02-shadcn-primitives.md)                                           | Done    |
| 3   | [Phase 3: i18n foundation](./phase-03-i18n-foundation.md)                                               | Done    |
| 4   | [Phase 4: Route groups, pure moves](./phase-04-route-groups-pure-moves.md)                              | Done    |
| 5   | [Phase 5: App chrome](./phase-05-app-chrome.md)                                                         | Done    |
| 6   | [Phase 6: Translate surface and settings popover](./phase-06-translate-surface-and-settings-popover.md) | Done    |
| 7   | [Phase 7: Dashboard hub](./phase-07-dashboard-hub.md)                                                   | Done    |
| 8   | [Phase 8: Preferences and Account routes](./phase-08-preferences-and-account-routes.md)                 | Done    |
| 9   | [Phase 9: Marketing landing](./phase-09-marketing-landing.md)                                           | Done    |
| 10  | [Phase 10: Vietnamese locale and switcher](./phase-10-vietnamese-locale-and-switcher.md)                | Done    |
| 11  | [Phase 11: Bilingual auth emails](./phase-11-bilingual-auth-emails.md)                                  | Pending |
| 12  | [Phase 12: Docs sweep](./phase-12-docs-sweep.md)                                                        | Pending |

Dependencies are linear, 1 → 12. Every phase leaves the app shippable.

**Two restructurings came out of the red-team pass and both changed the shape of the work:**

- **i18n moved to Phase 3, English-only.** It was originally one late phase that would
  have rewritten every component built in the surface phases. Now the seam exists first,
  every surface writes dictionary keys natively, and Phase 10 fills in Vietnamese.
- **The chrome phase split in two.** Phase 4 moves every page into route groups with
  layouts that reproduce today's chrome exactly — nothing looks different, so the review
  question is trivial. Phase 5 then builds the real chrome.

**Nav items land with their routes.** `typedRoutes: true` rejects an `href` to a route
that does not exist, at build. So the sidebar ships Translate in Phase 5, gains Dashboard
in Phase 7, and Preferences + Account in Phase 8. The original plan listed all four in the
chrome phase and could not have built.

## Key decisions already taken

| Decision                                          | Why                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route groups, not `/app/*` URL segments           | Three chromes need three `layout.tsx` files; route groups give that without moving a single URL.                                                                                                                                                                                                      |
| Sidebar kept over counsel's objection             | Counsel argued 2 destinations do not earn a sidebar. Resolved by making Preferences and Account their own routes — 4 items now, 5 at milestone 6.                                                                                                                                                     |
| Hub holds `DirectionToggle` + start only          | Settings live in the translate popover and at `/preferences`; a third copy on the hub is not a design.                                                                                                                                                                                                |
| Locale in a cookie, no URL prefix                 | A `/vi` `/en` prefix rewrites the `proxy.ts` matcher — the regex whose own comment records a near-miss leaking a live token into `?next=` — plus every `Link href` and `sameOriginPath`. Nest-minted email links would stay unprefixed forever.                                                       |
| `?lang=` via a route handler, not the root layout | App Router layouts receive no `searchParams`. Middleware would need the matcher surgery the cookie decision exists to avoid, and a client-side read reintroduces the language flash. `GET /locale?lang=&next=` sets the cookie and redirects, with `next` validated by the existing `sameOriginPath`. |
| No i18n library                                   | `next-intl`'s value is routing middleware and navigation wrappers; the cookie decision deletes both from the requirements.                                                                                                                                                                            |
| `packages/i18n`, not `packages/ui`                | `ui`'s root entry must stay dependency-free for Metro, and product copy in a component library is the "primitive that knows what a meeting is" mistake the guidelines name.                                                                                                                           |

## Success Criteria

- [ ] `/` renders a marketing landing, publicly reachable, with its own header and a mobile sheet
- [ ] `/dashboard` requires a session and shows only real state — no stat tiles, no "0 conversations", no charts
- [ ] `/translate` renders inside the app shell with the sidebar collapsed to an icon rail, and the translation is the largest thing on the surface
- [ ] Translate settings open from a topbar popover; direction and voice are disabled while a conversation runs
- [ ] Auth routes render under an auth-only chrome — no app nav, no sign-out control
- [ ] Post-login default is `/dashboard`; an explicit `?next=` still wins
- [ ] A language switcher flips every web surface between VI and EN; first visit is negotiated from `Accept-Language`
- [ ] Auth emails arrive in the recipient's language
- [ ] Error and 404 boundaries exist per route group; `(auth)/error.tsx` renders no query value
- [ ] `pnpm -w test`, `typecheck`, `lint`, `build` green — specifically `skin-guard`, `app-skin-guard`, `token-parity`, `contrast-floors`
- [ ] No hex in `packages/ui/src/tokens.ts` changed
- [ ] `docs/design-guidelines.md` § State inventory covers the new surfaces; § Copy register covers the new strings

## Risks

| Risk                                                                                      | Signal it broke                                                     | Response                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The hub drifts into a pretend dashboard                                                   | A stat tile, a "0 conversations" card, or a chart appears in review | Reject in review. This is the single biggest failure mode and no test catches it.                                                                      |
| Accent sprawl on app screens                                                              | More than one accent-filled control on a screen                     | Review-only; "per viewport" is visual. Marketing sections get render specs in Phase 9; app screens get a checklist entry in Phase 12.                  |
| A stock `bg-primary/90` hover survives the re-skin                                        | The new skin-guard row fails                                        | **No longer review-only.** Phase 2 adds `bg-primary/\d` to both guards — which already catches a live violation in `badge.tsx` that has been shipping. |
| Phase 10 becomes a late mega-phase                                                        | Missed strings, register violations, rushed VI copy                 | The reason i18n moved to Phase 3. Phase 10 is now a fill, not an extraction.                                                                           |
| Locale implemented with the theme pattern                                                 | Hydration mismatch warnings, a visible language flash on load       | Named as an anti-pattern in Phase 8. Locale must be server-known; the switcher goes through `router.refresh()`.                                        |
| Adding `--sidebar-*` tokens forces the extension popup to declare tokens it never renders | `token-parity` fails on the popup surface                           | Phase 1 makes the mapping per-surface first, and sidebar tokens alias existing palette keys rather than minting new ones.                              |
| String extraction fossilises copy in two places                                           | A copy edit requires editing a spec too                             | Phase 8: the 7 copy-asserting specs import the EN dictionary rather than restating it.                                                                 |

## Open questions

1. ~~Sidebar label for `/dashboard`~~ — **decided 2026-08-25: "Bảng điều khiển".** The
   premise was wrong: the rail hides labels entirely rather than truncating them, so
   rail width was never the constraint, and expanded the sidebar is 16rem. The
   mockup's own Vietnamese screen already shows it fitting. Lands with the route in
   Phase 7, the Vietnamese in Phase 10.
2. ~~Does the landing hero need a recorded demo clip?~~ — **answered by Phase 9's own
   architecture: no.** The hero visual is a real `Card` drawing a two-turn conversation
   with the product's own type hierarchy. A clip would go stale, render at one theme on
   a page with two, and say nothing to a screen reader.
3. Does the live status belong in the topbar? The mockup's translate screen draws a
   status pill and a direction readout there; Phase 6's own "Chrome that does not hide"
   section says status stays in `CascadePanel`. Phase 6 followed the phase file and left
   the route title in place. The slot mechanism now exists, so moving it is small work —
   it needs a decision, not an implementation. Decide before Phase 9.
4. ~~Vietnamese register of address~~ — **decided 2026-08-25: neutral "bạn".** Chosen over
   "quý khách" (too formal for a daily tool) and over avoiding pronouns entirely. Goes
   into `docs/design-guidelines.md` § Copy register in Phase 12; Phase 10 writes to it.

<!-- slug: web-ia-and-ui-revamp -->
