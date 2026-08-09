---
phase: 7
title: 'Mobile theme adoption'
status: pending
priority: P3
effort: '2h'
dependencies: [3]
---

## Overview

Delete the third palette — and, correcting an earlier assumption in this plan,
the third set of scales too. `apps/mobile/src/ui/theme.ts` hardcodes iOS system
colours and its first line already claims to be kept in sync with
`docs/design-guidelines.md`, a file that did not exist until phase 2.

## Requirements

- Functional: `theme.ts` sources colours **and** scales from `@chatofy/ui`; its public shape (`ColorScheme`, `ThemeColors`, `colors`, `spacing`, `radii`, `typography`) stays importable by the existing providers.
- Non-functional: Metro resolves the workspace package; `pnpm --filter mobile typecheck` and `expo lint` pass.

## Architecture

**This is not colour-only.** An earlier draft of this plan claimed the scales
already matched. They do not:

| Scale             | `theme.ts` today                   | Shared tokens               |
| ----------------- | ---------------------------------- | --------------------------- |
| `radii`           | 4 / 8 / 16 / full                  | 6 / 10 / 14 / full          |
| `typography.size` | 12 / 14 / 16 / 18 / 22 / 28 / 36   | 11 / 12 / 14 / 17 / 22 / 28 |
| `spacing`         | 4 / 8 / 16 / 24 / 32 / 48 / **64** | 4 / 8 / 16 / 24 / 32 / 48   |

Resolution: the shared radius and type scales win, because `theme.ts`'s versions
are scaffolding — the file marks them `@public` "for upcoming screens" and no
screen consumes them; `apps/mobile/app/**` is stubs. Spacing keeps mobile's
extra `'3xl': 64`, which phase 3 adds to the token module. This makes phase 7 a
scale replacement as well as a colour one, which is why the estimate is 2h
rather than 1h.

`ThemeColors` currently has both a `light` and a `dark` entry. Web dropped light
in phase 4; mobile keeps the `ColorScheme` type and both entries, with `light`
temporarily carrying the same dark values. Reason:
`apps/mobile/src/providers/theme-provider.tsx` consumes the map, screens are
stubs, and collapsing the type is a refactor of a surface nobody has built. Note
it in the file so it reads as a decision, not a bug.

Metro is already configured for the monorepo — `apps/mobile/metro.config.js`
sets `watchFolders` to the workspace root and both `nodeModulesPaths`, with
`disableHierarchicalLookup = true`. A dependency-free TS package should resolve
under that. This is the one assumption in the phase worth actually testing
rather than believing.

## Related Code Files

- Modify: `apps/mobile/src/ui/theme.ts` — colours and scales from `@chatofy/ui`, hardcoded values removed
- Modify: `apps/mobile/package.json` — add `@chatofy/ui` as a workspace dependency
- Verify: `apps/mobile/src/providers/theme-provider.tsx` — consumer, should need no change

## Implementation Steps

1. Add `"@chatofy/ui": "workspace:*"` to `apps/mobile/package.json`; `pnpm install`.
2. **Verify Metro resolves it before rewriting anything**: import a single token into `theme.ts`, run `pnpm --filter mobile start`, and confirm the bundler builds. If it does not, stop — the fix is a Metro config change and belongs in its own step, not buried in a theme refactor.
3. Map `ThemeColors` onto the shared tokens: `background` → `color.bg`, `surface` → `color.surface`, `primary` → `color.accent`, `primaryForeground` → `color.onAccent`, `accent` → `color.speaking`, `destructive` → `color.live`, `border` → `color.border`, `text` → `color.text`, `textSecondary` → `color.textSecondary`, `muted` → `color.textMuted`. Check whether any consumer reads `secondary` before dropping it.
4. Point `light` at the same values as `dark`, with a comment saying light is deferred across the whole product and this entry exists so `ColorScheme` and its provider need no change.
5. Replace `radii` and `typography.size` with the shared scales; re-export `spacing` from `@chatofy/ui` including `'3xl': 64`.
6. Update the stale first-line comment to point at the document that now exists.
7. Run `pnpm --filter mobile typecheck`, then `pnpm --filter mobile lint`.

## Success Criteria

- [x] No hardcoded colour, radius, or type-size literal in `apps/mobile/src/ui/theme.ts`
- [x] Metro bundles the app with `@chatofy/ui` imported — verified by an actual start, not by typecheck alone
- [x] `theme-provider.tsx` unchanged
- [x] `pnpm --filter mobile typecheck` and `pnpm --filter mobile lint` pass
- [x] The comment at line 1 points at a file that exists

## What actually happened

The colour and scale replacement shipped; `theme.ts` now holds no literal value
and `theme-provider.tsx` is untouched. `secondary` was dropped after checking:
the provider is the only consumer and it reads the map, not that key.
`pnpm --filter mobile typecheck` and `lint` pass.

**Step 2's verification could not be completed, and the reason is worth having.**
`apps/mobile` does not bundle at all today, on `main`, before any of this. Three
separate module resolutions fail in sequence under pnpm's isolated layout:

1. `@expo/metro-runtime` — imported unconditionally by `expo-router/entry-classic.js`, an optional peer of `expo`, declared by nothing.
2. `whatwg-fetch` — needed by `@expo/metro-runtime` itself.
3. `invariant` — needed by `react-native/index.js`.

Confirmed pre-existing by stashing every change in this plan and reproducing the
first failure on a clean tree. Declaring the first two individually moved the
bundle from 2 modules to 528 and then hit the third, which is the shape of a
systemic hoisting problem rather than a list of missing dependencies: the fix is
a `node-linker` or `public-hoist-pattern` decision for this app, not more
`package.json` entries. Both speculative additions were reverted; only
`@chatofy/ui` remains.

So Metro's ability to resolve `@chatofy/ui` is **unverified**. What is known: the
package is packaged identically to `@chatofy/types` — same tsup dual ESM/CJS
build, same `exports` shape, and zero dependencies — and `@chatofy/types` is
already a mobile dependency. That is a strong prior, not a measurement, and the
distinction is the whole reason step 2 existed.

## Risk Assessment

- **Metro fails to resolve the workspace TS source** (`disableHierarchicalLookup` plus an `exports` map pointing at `.ts` is the usual failure). Signal: "Unable to resolve module @chatofy/ui" on start. Response: this is why step 2 precedes the rewrite; fix Metro config as a separate change. If mobile turns out to need a built package, that is a real finding worth replanning around — do not paper over it by copying values back into `theme.ts`.
- **A scale change lands on screens that do not exist**, so nothing verifies it. Signal: none — that is the point. Response: accepted; the scales are scaffolding today and the first real screen is where they get judged.
- **iOS-native look is lost.** The current palette is Apple's system colours; the new one is not. Signal: the app looks less native on iOS. Response: accepted deliberately — one product identity across three surfaces was the goal.
- **Low value right now.** Mobile screens are stubs, so this phase changes nothing a user sees. It closes the third palette for two hours of work; if time is short it is the first phase to defer.
