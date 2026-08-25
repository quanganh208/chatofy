---
title: 'Phase 1: Design tokens and parity'
status: done
priority: P1
dependencies: []
---

# Phase 1: Design tokens and parity

## Overview

Make the token layer able to absorb everything the later phases need, before anything
renders. Two changes: one new type step for the marketing hero, and a per-surface
parity mapping so a web-only token stops being forced into the extension popup.

Nothing user-visible changes in this phase.

## Requirements

- [x] A `display` step exists in `fontSize` and reaches Tailwind as `--text-display`
- [x] `token-parity.spec.ts` can express "this property belongs to web only" without failing the popup surface
- [x] No hex in `tokens.ts` changes
- [x] `contrast-floors.spec.ts` untouched and green

## Architecture

### The type step

The scale stops at `xl` 28px, which is a page title. A marketing hero needs one more
step. Add `display` to `fontSize` in `packages/ui/src/tokens.ts`, then a role-named
`--text-display` to `@theme inline` in `apps/web/app/globals.css`, then the mapping
entry in `TYPE_MAPPING`.

Three traps, all documented in the guidelines and all silent:

1. **The entry must sit inside the FIRST `@theme inline` block.** `token-parity.spec.ts`
   matches non-greedily, so a second block renders correctly in the browser and tests
   as absent.
2. **Role name, never a size name.** `--text-2xl` or similar would override Tailwind's
   own utility of that name at a different value and re-typeset the app silently.
3. **Weight caps at 600.** `fontWeight` has no heavier key and the guidelines say
   "nothing heavier".

**Implemented as a flat `44px`, not the `clamp()` this phase first proposed.** The
existing type test asserts `^(\d+)px$` against the token — a `clamp()` fails it with
"is not Npx" — and there is a second test requiring a `--text-*--line-height` companion,
because a size declared without one falls back to the inherited 1.5. Taking this phase's
own recorded fallback was cheaper than teaching two tests about a CSS function for one
step. A hero that needs to shrink uses a responsive utility at the call site.

### Per-surface parity

`token-parity.spec.ts` runs `describe.each(SURFACES)` over one shared `MAPPING`,
`TYPE_MAPPING` and `EDGE_MAPPING`, asserting **both directions**: every mapped
property must exist in the surface, and the surface may declare no colour the mapping
does not account for. That is exactly right for the shared palette and exactly wrong
for a token only web renders.

Phase 2 will add sidebar tokens as **aliases of existing palette keys** — no new hex —
but the popup would still be forced to declare them. So the mapping gains a surface
scope. Keep the table hand-written; an inferred mapping was rejected for a recorded
reason and that does not change.

Shape (illustrative, not prescriptive — match the file's existing style):

```ts
const SURFACES = [
  { label: 'apps/web/app/globals.css', path: '…', scope: 'web' },
  { label: 'apps/extension/…/theme.css', path: '…', scope: 'popup' },
] as const;

/** Properties only one surface declares, and which surface owns each. */
const SURFACE_ONLY: Record<string, 'web' | 'popup'> = {
  '--text-display': 'web',
};
```

Both assertions consult it: the "every mapped property is present" test skips a
property owned by another surface, and the "declares no unaccounted colour" test still
covers it on its owner. A property in `SURFACE_ONLY` that appears on the _wrong_
surface must fail — otherwise the escape hatch is a hole.

## Related Code Files

- Modify: `packages/ui/src/tokens.ts` — add `fontSize.display`
- Modify: `apps/web/app/globals.css` — add `--text-display` inside the first `@theme inline`
- Modify: `apps/web/src/design/token-parity.spec.ts` — `SURFACE_ONLY`, surface scope, `TYPE_MAPPING` entry
- Modify: `packages/ui/src/lib/utils.ts` — **`TYPE_SCALE`, a third home for these names found during implementation.** `cn`'s tailwind-merge config files any unknown `text-*` as a COLOUR and drops it; `type-scale-merge.spec.ts` compares the list against web's stylesheet. Shared across surfaces even though the role is web-only, because omitting it reintroduces the silent-drop bug that list exists for.
- Read only: `apps/extension/entrypoints/popup/theme.css` — must stay unchanged
- Read only: `docs/design-guidelines.md` § Type

## Implementation Steps

1. Add `display: 44` to `fontSize` in `tokens.ts` with a docblock saying it is the
   marketing hero step and why it is flat rather than a clamp.
2. Add `--text-display: 44px;` and `--text-display--line-height: 1.05;` to the **first**
   `@theme inline` block in `globals.css`.
3. Add `scope` to `SURFACES` and introduce `SURFACE_ONLY` in `token-parity.spec.ts`.
4. Teach both direction assertions to consult `SURFACE_ONLY`, including the negative
   case (owned by web, found in the popup → fail).
5. Add `'--text-display': 'display'` to `TYPE_MAPPING`, and `'display'` to `TYPE_SCALE`
   in `packages/ui/src/lib/utils.ts`.
6. Run the design specs, then prove the new guard by deliberately breaking it.

## Success Criteria

- [x] `pnpm --filter web test` green, including `token-parity` and `contrast-floors`
- [x] `pnpm --filter @chatofy/ui test` green
- [x] `apps/extension/entrypoints/popup/theme.css` has no diff
- [x] `git diff packages/ui/src/tokens.ts` shows no hex change
- [x] A deliberate experiment proves the guard works: temporarily add `--text-display` to the popup stylesheet, watch parity fail, revert

## Risk Assessment

**The `SURFACE_ONLY` escape becomes a dumping ground.** Signal: more than a handful of
entries, or a shared palette colour appearing in it. Response: it is for properties one
surface genuinely owns, never for "the popup has not caught up yet" — that is a real
divergence and belongs in a comment and an issue, not in an exemption list.

**~~The clamp and the token drift.~~ Resolved during implementation** by dropping the
clamp: the existing type test asserts `^(\d+)px$` and a sibling test demands a
line-height companion, so a CSS function would have needed both taught about it for one
step. Flat `44px`, like every other step, and nothing can drift.
