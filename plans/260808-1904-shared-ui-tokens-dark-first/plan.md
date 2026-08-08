---
title: 'Shared UI Tokens Dark First'
description: 'One token source in @chatofy/ui, consumed by web, extension and mobile; dark-first indigo visual direction applied to /translate and the meeting overlay.'
status: completed
priority: P1
effort: '4-5d'
tags: [design-system, ui, extension, web, mobile]
created: 2026-08-08
---

# Shared UI Tokens Dark First

## Overview

Three surfaces currently carry three unrelated palettes and no brand at all:
`apps/web/app/globals.css` (stock shadcn OKLCH, pure grayscale), the overlay
`STYLE` constant in `apps/extension/entrypoints/content/index.ts` (hardcoded
zinc/red/amber/blue hex), and `apps/mobile/src/ui/theme.ts` (hardcoded iOS
system hex). `packages/ui` is an empty stub whose stated trigger — "the same
pattern appears in 2+ apps" — has already fired, but the thing duplicated is
**tokens, not components**.

This plan makes `packages/ui` a dependency-free TypeScript token module, adopts
a dark-first indigo direction across web and the extension, and redesigns the
web translate surface. It deliberately does **not** introduce a shared React
component layer: web has exactly two primitives (`button.tsx`, `card.tsx`), the
extension has no React and no Tailwind by design (`apps/extension/wxt.config.ts`
records why), and mobile screens do not exist yet.

Dark-first is not a taste call alone. The meeting overlay renders on top of
someone else's video and can never follow `prefers-color-scheme` — inside a
content script that reflects the OS, not the page, so a light-OS user in a dark
Meet would get a white box over video. If web stays light, the two surfaces can
never read as one product.

Honest weighting: tokens are phases 3-4 but move roughly 15% of perceived
quality. Phase 5 — hierarchy, states, rhythm and motion in
`apps/web/src/components/translate/*` — is where the product stops looking
unfinished. Stopping after phase 4 delivers correctness and no visible win.

That is the plan's central risk, and it is scheduled against: phase 5 ships as
two PRs, its mechanical half (5a) runs **in parallel** with phase 6 rather than
after it, and 5b ends in a dated side-by-side screenshot so a slip surfaces
mid-plan instead of at the end.

Phase 1 also picks up a live defect found while planning: `STYLE` sets
`display: flex` on `.indicator` and `.error` while the code hides them with the
`hidden` property and the sheet declares no `[hidden]` rule — so the capture
indicator never hides and the error bar is a permanent empty strip. Verified by
reading `apps/extension/entrypoints/content/index.ts:49,71,314,337`.

## Goals

| #   | Goal                                                                                          | Priority |
| --- | --------------------------------------------------------------------------------------------- | -------- |
| 1   | One token source of truth; the three divergent palettes collapse to one                       | P1       |
| 2   | Web `/translate` and the extension overlay read as the same product                           | P1       |
| 3   | Overlay style isolation survives a hostile meeting page                                       | P1       |
| 4   | `docs/design-guidelines.md` exists — `apps/mobile/src/ui/theme.ts:1` has always pointed at it | P2       |
| 5   | Mobile consumes tokens without pulling any DOM code                                           | P3       |

## Non-goals

- Landing / marketing page. `docs/project-overview-pdr.md:33` descopes the full web app.
- Universal UI (Tamagui, react-native-web, Unistyles). Nothing to unify yet.
- Rewriting the content-script overlay in React or Tailwind.
- Designing mobile screens. They are stubs; tokens now, screens later.
- NativeWind.
- Light theme for web. Deferred, not rejected — `@custom-variant dark` stays in place.

## Constraints

- The overlay keeps its delivery mechanism byte-for-byte: `closed` shadow root,
  `textContent` only, `style.textContent = STYLE`. No `adoptedStyleSheets`, no
  constructed stylesheet, no fetched CSS, no `web_accessible_resources` (the
  latter is impossible here — Chrome requires a WAR path of exactly `/*` and
  `https://*.zoom.us/wc/*` carries a path, so the manifest fails at load).
- Tokens reach the overlay as **literal interpolated values, never CSS custom
  properties**. `all: initial` does not reset custom properties — they cross the
  shadow boundary by design, so a variable-based overlay theme is repaintable by
  the meeting page.
- `packages/ui` stays dependency-free: no React, no DOM types. Metro must import it.
- Colors are hex/sRGB, not `oklch`. RN 0.83 colour-function support is not worth betting the mobile build on.
- Nothing in `apps/api`, `packages/realtime-client`, or `packages/ai-providers` is touched. Benchmark paths stay frozen.
- No new build step and no codegen. Sync is enforced by one test.

## Phases

| #   | Phase                                                                                               | Status |
| --- | --------------------------------------------------------------------------------------------------- | ------ |
| 1   | [Phase 1: Overlay style isolation hardening](./phase-01-overlay-style-isolation-hardening.md)       | Done   |
| 2   | [Phase 2: Design guidelines and token decision](./phase-02-design-guidelines-and-token-decision.md) | Done   |
| 3   | [Phase 3: Shared token module](./phase-03-shared-token-module.md)                                   | Done   |
| 4   | [Phase 4: Web token wiring](./phase-04-web-token-wiring.md)                                         | Done   |
| 5   | [Phase 5: Web translate surface redesign](./phase-05-web-translate-surface-redesign.md)             | Done   |
| 6   | [Phase 6: Extension overlay restyle](./phase-06-extension-overlay-restyle.md)                       | Done   |
| 7   | [Phase 7: Mobile theme adoption](./phase-07-mobile-theme-adoption.md)                               | Done   |
| 8   | [Phase 8: Extension popup restyle](./phase-08-extension-popup-restyle.md)                           | Done   |

Dependency order: 1 is independent and ships as its own PR — it is a security
and correctness fix, not a design change, and its merge must not wait for any
later phase. It is sequenced first only because it edits the same `STYLE` and
host code phase 6 rewrites. Then 2 → 3 → 4, then {5a, 6, 7} in parallel, then
5b. 8 is conditional — do it only if the popup still looks wrong after phase 6
has given it the shared state colours.

## Design direction (decided)

Dark-first, cool indigo accent. Locked in the brainstorm round; phase 2 writes it down.

```
neutral   bg #0C0C0E · surface #111113 · raised #17171A
          border #26282D · borderStrong #35373D
          text #EDEEF0 · textSecondary #B4B6C0 · textMuted #8B8D98
accent    #6E56CF · hover #7A5FD6 · text #9B87F5 · subtle #2A2250 · onAccent #FFFFFF
state     live #E5484D · fill #D13438 / subtle #3B1219 — dot vs. anything white sits on
          speaking #30A46C                — a translation is playing
          warning #FFB224 / subtle #3B2400 — mic grant, unpatched page notice
type      11 / 12 / 14 / 17 / 22 / 28 px · weight 400 · 500 · 600
radius    6 / 10 / 14 / full
spacing   4 / 8 / 16 / 24 / 32 / 48 / 64
```

These **replace** the scales in `apps/mobile/src/ui/theme.ts`, which ships radii
4/8/16 and type 12/14/16/18/22/28/36 — disagreeing at nearly every step. Its
scales are scaffolding marked "for upcoming screens" and no screen reads them,
so the shared scale wins; only the `64` spacing step is carried over. Phase 7 is
therefore a scale change as well as a colour one.

Two things deliberately stay out of the shared package: the overlay's
`z-index: 2147483647` and its font stack. Both are overlay-specific, and an
overlay that inherits the page's font is one more injection surface.

## Success Criteria

- [ ] `packages/ui/src/tokens.ts` is the only place a brand colour is authored
- [ ] `apps/mobile/src/ui/theme.ts` and the overlay `STYLE` contain no hardcoded brand hex
- [ ] A test fails when `globals.css` and `tokens.ts` disagree
- [ ] `docs/design-guidelines.md` exists, matches the shipped tokens, and carries real contrast numbers
- [ ] `pnpm --filter extension test` and `pnpm --filter extension test:e2e` pass; a hostile-page style cannot hide, move or transform the capture indicator
- [ ] The indicator and error bar actually hide when the code hides them
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm build` clean
- [ ] Web `/translate` and the overlay, screenshotted side by side, read as one product

Verification commands are per-workspace and cannot be chained as arguments —
`pnpm --filter web test typecheck lint build` runs `vitest run typecheck lint
build`, not four scripts. Every phase spells them out separately.

## Open questions

1. Is a benchmark rerun planned after the 2026-08-07 results? Nothing here touches those paths, but worth confirming before a broad refactor lands.
2. Does the extension popup actually hurt enough to justify phase 8? Decide by looking at it after phase 3, not now.

<!-- slug: shared-ui-tokens-dark-first -->
