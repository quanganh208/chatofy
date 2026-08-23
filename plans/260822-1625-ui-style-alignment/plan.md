---
title: 'UI style alignment: direction C1 + Be Vietnam Pro'
description: 'One control language across web and the extension popup: recessed fields, borderless raised buttons, a shared Input primitive, and a single typeface. Records the accessibility trade-off C1 makes.'
status: complete
priority: P2
effort: '2.5-3.5d'
tags: [ui, design-system, accessibility, web, extension]
created: 2026-08-22
---

# UI style alignment: direction C1 + Be Vietnam Pro

Review artifacts, all self-contained and openable from disk:

- [`mockup.html`](./mockup.html) — the systems audit that started this
- [`specimen.html`](./specimen.html) — the border × font picker the decision came from
- [`direction-c.html`](./direction-c.html) — C1 and C2 side by side, the accepted design
- [`redesign.html`](./redesign.html) — a login composition study, **not accepted**, see Non-goals

Builds on [`../260822-1100-auth-nest-idp-with-nextauth-web/plan.md`](../260822-1100-auth-nest-idp-with-nextauth-web/plan.md)
(`status: complete`), which created every auth surface this plan restyles. Not a
blocking dependency — that work landed on this branch already.

## Overview

Two surfaces render `@chatofy/ui/react` and they do not currently match. The gap
is not stylistic drift to be tidied; it is three concrete defects found by
reading the source:

1. **Text fields are hand-rolled twice and use the wrong token.**
   `apps/web/src/components/auth/login-form.tsx:8` and
   `apps/extension/entrypoints/popup/sign-in-pane.tsx:23` each declare their own
   class string, both bordered with `border-hairline`. `globals.css:231-235`
   states that token measures 1.34:1 and is a surface hairline, ending with
   _"never substitute this for it"_ about `--border-control`. There is no `Input`
   primitive for either file to have used.

2. **The two surfaces render different typefaces.** `apps/web` loads Inter
   through `next/font/google` (`layout.tsx:2`). The popup cannot: `--font-inter`
   is set on `<html>` by `next/font` at render time and does not exist in an
   extension page, so `theme.css:15-18` documents the popup deliberately keeping
   `system-ui`. Web and popup have never shared a typeface.

3. **`Button`'s `outline` variant draws a control border on a ground it was not
   solved for.** `tokens.ts:76-78` solves `borderControl` against `surfaceRaised`
   — the filled control it is meant to edge — where it lands on exactly 3.03:1.
   Every call site renders it on some other ground: 3.34/3.36 on a card, 3.26/3.65
   on the page. Harder than designed, and enclosing nothing.

Direction **C1** is the accepted answer, chosen from `specimen.html` after three
rounds. Controls lose their hard outline. A field reads as a well cut into the
surface (inset shadow, never lifts); a button reads as an object sitting on it
(drop shadow, lifts 1px on hover, presses 1px on active). The distinction cannot
come from fill — `card` and `secondary` differ by 1.10:1 — so it comes from the
direction of depth.

## The trade-off C1 accepts, on the record

C1's hairline composites to **1.13:1** (light) and **1.17:1** (dark). WCAG 1.4.11
asks 3:1 for the boundary of a control at rest. In this palette nothing softer
than `--border-control` can reach it: `border-strong` measures 2.07/1.87 and
`border` 1.27/1.23. That is a property of the ramp, not a value to tune.

The user was shown these measurements alongside variant C2 (which clears the
floor) and chose C1 deliberately. This plan therefore implements C1 and records
the exception rather than relitigating it. Two facts bound the cost:

- **The focus ring is unaffected and carries state indication.** `--ring` measures
  6.70:1 at worst across every ground a control sits on (card, page, surfaceRaised,
  warningSubtle, liveSubtle) in both themes. 1.4.11's state half stays satisfied;
  only the at-rest boundary is given up.
- **`contrast-floors.spec.ts` will not turn red.** Its 3:1 rows measure the
  _token_ against grounds, and the token still contrasts. Those rows become
  measurements of something nothing renders. Phase 5 rewrites them rather than
  leaving a green test that has stopped asking a question.

One test does fail and must be changed: `skin-guard.spec.ts:107-115` asserts
`alert.tsx` re-borders a notice's actions in the notice's own hue, and its comment
records why (`borderControl` reaches only 2.70:1 on `liveSubtle`). C1 removes the
border that override exists to correct. Phase 3 owns this.

## Phases

| #   | Phase                                                                       | Status   |
| --- | --------------------------------------------------------------------------- | -------- |
| 1   | [One typeface on both surfaces](./phase-01-typeface.md)                     | Complete |
| 2   | [The `Input` primitive](./phase-02-input-primitive.md)                      | Complete |
| 3   | [Button C1, and the Alert override it invalidates](./phase-03-button-c1.md) | Complete |
| 4   | [Adoption across every call site](./phase-04-adoption.md)                   | Complete |
| 5   | [Docs and contrast floors reconciled](./phase-05-docs-and-floors.md)        | Complete |

Phase 3 is the gate. It is the only phase that removes an accessibility
correction, and it is where the design either reads as intended on a real notice
or does not. Phase 4 is repetition of a proven shape; phase 5 is bookkeeping that
must not be skipped, because it is what stops the next reader from restoring the
border on the authority of a comment this plan made false.

## Non-goals

- The login composition in `redesign.html` (split screen, live transcript panel).
  It was a study; it is not accepted and nothing here depends on it.
- Palette changes. No colour value is added, removed, or altered.
- The extension **overlay**. `overlay-invariants.spec.ts` forbids `var(` in its
  sheet as a security invariant; it draws itself and stays untouched.
- `apps/mobile`. React Native, imports the root token entry only.
- The translate panels (`cascade-panel`, `live-panel`, `result-card`). They are
  already composed from shared components and are consistent.
- `Tabs`, deliberately consumer-less today. (`Select` is **in** scope — phase 4
  decides whether its trigger follows C1. It was listed here and simultaneously
  given work in two phases, which is a contradiction, not a non-goal.)

## Acceptance criteria

Commands first, because the ones this plan originally named do not exist. The
root `package.json` has no `test` script, and `test` / `test:e2e` are separate
turbo tasks — so `pnpm test` errors rather than reporting green, and the e2e never
runs under it.

```bash
pnpm turbo run test                      # unit/spec across workspaces
pnpm --filter extension test:e2e         # the popup e2e — a SEPARATE gate
```

- [x] `grep -rn "const FIELD\|const field" apps/` returns nothing.
- [x] `grep -rn "border-hairline" apps/ packages/` returns no hit on an
      **interactive** element. Surface uses stay: `card.tsx`, `alert.tsx`, the
      popup status pill, and the transcript's empty state are surface treatments
      this plan does not change.
- [x] `grep -rnE "text-(xs|sm|base|lg|xl|[0-9]xl)\b" apps/ packages/ui/src` returns
      nothing outside a comment, and no `text-[NNpx]` arbitrary value was
      introduced in its place.
- [x] Both stylesheets declare a `--font-sans` whose family segment matches a
      shared constant, and each keeps a fallback tail. Runtime equality of the
      rendered face is confirmed once per surface in devtools — `next/font` mints
      a build-time hashed family that appears in no source file, so no spec can
      compare the two by string.
- [x] The committed popup font files are reproducible: pinned upstream version,
      SHA-256 of source and emitted woff2, the exact subsetting invocation, and
      the OFL license file.
- [x] A field and a button rendered adjacent differ in depth direction, and the
      button is the only one of the two that moves on `:active`.
- [x] Every interactive element ships default, hover, focus-visible, active,
      disabled, and — where it applies — invalid.
- [x] Reduced motion suppresses the **transform**, not merely the transition.
- [x] `pnpm turbo run test` green across `packages/ui`, `apps/web`, `apps/extension`.
- [x] `pnpm --filter extension test:e2e` green, **including a new signed-out popup
      scenario**. Today `e2e/run.mjs` defaults `signedIn = true`, so the only
      horizontal-overflow check never renders the sign-in pane — the exact pane
      phases 1 and 4 rewrite. That scenario must exist before phase 1 lands.
- [x] `token-parity.spec.ts` green, with `--font-be-vietnam` added to
      `DECLARED_ELSEWHERE` and `--inset-field` mapped.
- [x] `docs/design-guidelines.md` states the C1 rule and its measured exception;
      no document still claims controls universally carry a 3:1 outline.

## Settled decisions

| Question          | Decision                                                                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Control height    | **40px** — `Input` matches `Button`'s existing `size.default` (`h-10`). Not 44px: that would mean changing every default button in the repo and re-measuring the popup, scope this plan was hiding. |
| `Input` font size | **14px** (`--text-body`). The 16px no-zoom floor is dropped: the type scale has no 16px step (11/12/14/17/22/28), mobile Safari reaches only `apps/web`, and the popup is Chrome-only.              |
| Notice actions    | **Keep the hue border** inside `Alert`. A hue-tinted fill measured 1.90:1 (dark) and 2.58:1 (light) for its label — it would have shipped an illegible microphone-permission button.                |
| `next` redirect   | **Same-origin clamp added in phase 4.** Pre-existing, unrelated to the restyle, but phase 4 opens the file.                                                                                         |

## Open questions — resolved

- **Hover lift / press.** Kept at `-1px` / `+1px`, matching `direction-c.html`.
  Verified in Chrome in both themes. Be Vietnam Pro serves display and body.
- **Where the extended lint guard lives.** `apps/web/src/design/app-skin-guard.spec.ts`.
  Putting it in `packages/ui` would have made a shared package's test fail
  because of an app that need not exist in a given checkout.
- **Is the `dark:` ban web-wide?** No — it is extension-only, and the guard is
  scoped that way. `globals.css` declares `@custom-variant dark` deliberately, so
  a `dark:` utility on web is supported; the popup declares no such variant and
  records that it must not. Still no violation on either surface.

## Found during implementation

Three defects the plan did not predict, each verified in a browser before being
fixed. Full detail in `../reports/`.

1. **`tailwind-merge` was silently dropping the type scale.** It cannot tell
   `text-body` from a text _colour_, so any variant setting both lost its size:
   `Button` rendered 12px in the popup, 16px on web, 14px for `outline` alone.
   Fixed in `cn()` with a guard; **user approved** the product-wide type change.
2. **C1 would have disabled the Alert's WCAG hue border.** The override names a
   border _colour_; its 1px came from the `outline` variant C1 removed, so the
   border would have vanished while `skin-guard` went on finding the class it
   greps for. `alert.tsx` now sets the width itself and the guard asserts it.
3. **Tailwind v4 `translate-*` writes the `translate` property, not `transform`.**
   The plan's "add `transform` to the transition list" would have shipped an
   un-eased jump.

One criterion could not be met as written: `/login` has never been statically
rendered (`await auth()` reads the session cookie; `next build` reports `ƒ /login`
before and after). See phase 4.

## Red Team Review

Three hostile reviewers, Full verification tier, run against the pre-review plan.
All findings carried `file:line` evidence and passed the evidence filter. 15
findings after deduplication; **all accepted**. The controller re-verified 11
claims by hand before applying, including the reviewers' contrast arithmetic.

Nothing here argued against direction C1. Every finding attacked how the plan
implemented it — which is what the reviewers were scoped to do.

| #   | Sev      | Finding                                                                                                                                                                                                                                          | Applied in    |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| A   | Critical | The named gate does not exist: root has no `test` script, `test`/`test:e2e` are separate turbo tasks, no "600px cap" assertion exists (the CSS cap is 560px), and `e2e/run.mjs` defaults `signedIn = true` so the sign-in pane is never measured | plan.md, 1, 4 |
| B   | Critical | Phase 1 step 5 deleted the popup's only unlayered `font-family` rule; preflight is layered and loses to Chrome's invisible popup sheet                                                                                                           | 1             |
| C   | Critical | `DirectionToggle` was described as a segmented control. It is one round icon button                                                                                                                                                              | 4             |
| D   | Critical | The hue-**fill** Alert action measured 1.90:1 (dark) / 2.58:1 (light) for its label, on the microphone-permission button                                                                                                                         | 3             |
| E   | High     | Font parity criterion unachievable: `next/font` mints a build-time hashed family; `DECLARED_ELSEWHERE` holds `--font-inter`; font binaries had no integrity anchor                                                                               | 1             |
| F   | High     | `Button` default is 40px, not 44; a base `height` races the `size` variants at equal specificity                                                                                                                                                 | 2, 3          |
| G   | High     | `motion-reduce:transition-none` suppresses easing, not the transform; the guard is substring-presence only                                                                                                                                       | 3             |
| H   | High     | The extended lint guard would scan **zero** app files (non-recursive walk, no top-level `.tsx`) and its pattern misses `text-2xl`                                                                                                                | 5             |
| I   | High     | Phase 5's superseded-claim range stopped at `:64`, missing `:65-85` and `alert.tsx:41-57`                                                                                                                                                        | 5             |
| J   | Medium   | The 16px `Input` floor has no token in the scale, and its rationale reaches only one of two surfaces                                                                                                                                             | 2             |
| K   | Medium   | The login restructure never named the `<Suspense>` boundary or the `googleConfigured` gate                                                                                                                                                       | 4             |
| L   | Medium   | "Diff the props" cannot protect the generic error, which is a string in the handler                                                                                                                                                              | 4             |
| M   | Medium   | Four line citations pointed at the wrong paragraph; "twelve primitives" is seven                                                                                                                                                                 | 2, 3, 5       |
| N   | Medium   | `Select` was a declared non-goal carrying work in two phases                                                                                                                                                                                     | plan.md, 3, 4 |
| O   | Medium   | The `border-hairline` acceptance grep was unmeetable against surfaces the plan never intended to change                                                                                                                                          | plan.md       |

**Found incidentally, outside the plan's scope:** `next` flows from
`params.get('next')` into `router.push(next as ...)` unvalidated
(`login-form.tsx:30` → `:49`), and `auth.ts` declares no `redirect` callback — so
the credentials path has no same-origin clamp while the Google path inherits one.
Accepted into phase 4 because that phase opens the file.

### Whole-Plan Consistency Sweep

Decision deltas applied across all six files: `pnpm test` → `pnpm turbo run test`
plus a separate `pnpm --filter extension test:e2e`; the 600px cap claim removed;
control height fixed at 40px; `Input` type at `--text-body`; the Alert hue border
retained as a recorded exception, which also withdrew the phase-3 rewrite of
`skin-guard.spec.ts:107-115` and the phase-5 rewrite of `contrast-floors.spec.ts:85`.
