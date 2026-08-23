---
title: 'Phase 2: The Input primitive'
status: complete
priority: P2
effort: '0.5d'
dependencies: [1]
---

# Phase 2: The Input primitive

## Overview

Add the `Input` primitive that should already have existed, drawn in direction
C1: a field is a well cut into the surface. Nothing adopts it yet — this phase
ships the component and its guard, phase 4 replaces the call sites.

## Requirements

**Functional**

- Exports from `@chatofy/ui/react`, usable by both DOM surfaces.
- Ships all six states: default, hover, focus-visible, disabled, invalid, and
  read-only where the platform distinguishes it.
- Carries no product vocabulary. A primitive that knows what a meeting is has
  been written in the wrong place (`docs/design-guidelines.md:295-296`).

**Non-functional**

- `font-size` is `--text-body` (14px), like every other control. The 16px
  mobile-Safari no-zoom floor was considered and **dropped**: the type scale has no
  16px step (11/12/14/17/22/28), mobile Safari reaches only `apps/web`, the popup
  is Chrome-only, and `apps/mobile` never imports this entry. Hard-coding
  `text-[16px]` would have left the single off-scale type value in the repo right
  after phase 4 removes the last one.
- Height is **40px** (`h-10`), matching `Button`'s existing `size.default`. Phase 4
  asserts the two agree; they only agree at 40.
- Reduced-motion escape on every transition, which `skin-guard.spec.ts` enforces
  by reading the source.

## Architecture

C1 gives the field its shape through an **inset** shadow rather than a border.
Two layers, one declaration, both themes carried at once in the manner
`globals.css` already uses for `--elevation-*`:

```css
--inset-field:
  inset 0 1px 2px light-dark(rgba(19, 19, 19, 0.07), rgba(0, 0, 0, 0.38)),
  inset 0 0 0 1px light-dark(rgba(19, 19, 19, 0.045), rgba(255, 255, 255, 0.045));
```

The second layer is the edge; the first is the recess. `light-dark()` wraps each
**colour**, never the whole list — a `box-shadow: light-dark(<list>, <list>)` is
invalid at computed-value time and silently resolves to `none` in both themes.
That trap is already documented at `globals.css:198-206` — the load-bearing
sentence is at `:200-202` — and it applies here too.

The field never lifts. Hover deepens the fill to `--muted` and nothing else moves.
That restraint is what separates it from a button at a glance, and it is the whole
mechanism — fill cannot do it, because `card` and `secondary` differ by 1.10:1.

Focus composes the ring **on top of** the inset rather than replacing it, so the
recess does not pop flat at the moment of focus:
`box-shadow: var(--inset-field), 0 0 0 3px …`.

Invalid uses `aria-invalid` as the selector, so the visual state and the state a
screen reader announces cannot drift apart.

## Related Code Files

- Create: `packages/ui/src/react/input.tsx`
- Modify: `packages/ui/src/react/index.ts` — export `Input`
- Modify: `apps/web/app/globals.css` — add `--inset-field`
- Modify: `apps/extension/entrypoints/popup/theme.css` — same token, hand-copied
  and checked by the parity spec rather than generated
- Modify: `packages/ui/src/tokens.ts` — add an `insetField` entry. It is a
  `surfaceEdge`-shaped value, not a palette colour, so it does not breach the
  palette non-goal — and without it there is nothing for the parity spec to compare
  against
- Modify: `apps/web/src/design/token-parity.spec.ts` — map `--inset-field`, and add
  it to the `light-dark()`-per-layer assertion at `:386-394`, which today iterates
  `ELEVATION_MAPPING` only and therefore cannot see this token at all
- Modify: `packages/ui/src/react/skin-guard.spec.ts` — the new file is subject to
  the existing re-skin bans automatically; confirm it trips none of them

## Implementation Steps

1. `shadcn add input`, then re-skin to this project's tokens. The generated file
   will arrive with `border-input`, `text-sm`, and a `@/lib/utils` import; all
   three are already banned by `skin-guard.spec.ts` and all three must go.
2. Replace the generated border treatment with `--inset-field`. Height `h-10`
   (40px), radius from `--radius-md`, `px-3`, type `text-body`.
3. Add hover, focus-visible, disabled, and `aria-invalid` states per Architecture.
4. Add `insetField` to `tokens.ts`, declare `--inset-field` in both stylesheets,
   map it in the parity spec, and extend the whole-list-`light-dark()` assertion to
   cover it. Without that last step the trap in Risk Assessment stays unguarded:
   the spec would red for "unmapped colour" rather than "invalid shadow", or miss
   it entirely.
5. Export from `index.ts`, beside the other primitives.
6. Write the component's own doc comment explaining why a field carries an inset
   and a button a drop shadow. The next person to touch this will otherwise
   "fix" the asymmetry.

## Success Criteria

- [x] `Input` renders identically in web and popup at the same width.
- [x] All six states demonstrable; `aria-invalid` drives the invalid visual.
- [x] Focus ring composes over the recess; the field does not flatten on focus.
- [x] `skin-guard.spec.ts` green — no `dark:`, no `border-input`, no `text-sm`,
      no `@/lib/utils`, and a `motion-reduce:` escape present.
- [x] `token-parity.spec.ts` green with `--inset-field` mapped **and** covered by
      the whole-list-`light-dark()` assertion.
- [x] `Input` and the default `Button` are both 40px, verified in the rendered DOM.
- [x] Nothing imports `Input` yet; `knip` does not report it, because the `./react`
      entry point's declared surface counts as used.

## Risk Assessment

**`light-dark()` wrapping the whole shadow list.** Resolves to `none` in both
themes, with no error anywhere, and Tailwind compiles the broken form happily.
_Signal:_ the field has no recess in either theme — not one theme, both.
_Response:_ wrap each colour individually, and make sure step 4's assertion
extension actually landed — that assertion is the only thing that turns this from
an eye-check into a test.

**Consumer-less primitive slips through review unnoticed.** `knip` treats a
package's declared public surface as used, so nothing mechanical will flag it
between this phase and phase 4. _Signal:_ none available. _Response:_ phases 2
and 4 land in the same PR, or phase 4 follows immediately. Do not leave `Input`
exported and unused across a merge boundary.
