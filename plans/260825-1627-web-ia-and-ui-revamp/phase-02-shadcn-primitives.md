---
title: 'Phase 2: shadcn primitives'
status: done
priority: P1
dependencies: [1]
---

# Phase 2: shadcn primitives

## Overview

Generate the eight primitives the new chrome needs from the shadcn CLI, re-skin each to
this project's tokens, and export them from `@chatofy/ui/react`. This is the bulk of
the mechanical work in the whole plan.

Nothing renders them yet. That is deliberate: the skin guard runs over the package, so
the primitives can be proved correct before a single layout depends on them.

## Requirements

- [x] `popover`, `dropdown-menu`, `avatar`, `sheet`, `tooltip`, `skeleton`, `sidebar`, `accordion` exist in `packages/ui/src/react/`
- [x] Every one is CLI-generated, then re-skinned — none hand-written
- [x] `skin-guard.spec.ts` green with no new exemptions
- [x] No new hex reaches `tokens.ts`

## Architecture

### Generation

The CLI is configured at `packages/ui/components.json` — style `new-york`,
`rsc: false`, aliases `components: "@/react"`, `ui: "@/react"`,
`hooks: "@/react/hooks"`, `utils: "@/lib/utils"`, css `src/styles/globals.css`,
icon library lucide. Run it from `packages/ui`.

`sidebar` pulls `sheet`, `tooltip`, `skeleton`, `separator`, `input`, `button` and a
`use-mobile` hook. `separator`, `input` and `button` already exist and must not be
clobbered — generate them one at a time and diff, rather than accepting a bulk
overwrite. `use-mobile` lands in `src/react/hooks/`, which does not exist yet.

### The re-skin, applied to every generated file

Four things in stock output are wrong here. Three are banned by
`packages/ui/src/react/skin-guard.spec.ts` today; the fourth becomes banned in this
phase — see the section below it.

| Stock shadcn                            | This project                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `hover:bg-primary/90`                   | `hover:bg-accent-hover` — guarded by this phase, see below                                                |
| `bg-accent`, `text-accent-foreground`   | `bg-secondary`, `bg-muted`                                                                                |
| `bg-popover`, `text-popover-foreground` | `bg-card`, `text-card-foreground` — this palette defines no popover token                                 |
| `border-input`                          | `border-control` or nothing                                                                               |
| `dark:` variants                        | `light-dark()` tokens; a `dark:` utility never fires here                                                 |
| `text-sm`, `text-xs`                    | `text-body`, `text-hint`, `text-label`                                                                    |
| `@/lib/utils` import                    | relative — the alias breaks `rollup-plugin-dts` only, so it passes every bundler and fails the type build |

### One of the "untested" rules turns out to be testable — and already violated

The plan first treated `hover:bg-primary/90` as review-only. It is not: both guards are
FORBIDDEN-regex tables over source (`packages/ui/src/react/skin-guard.spec.ts:45`,
`apps/web/src/design/app-skin-guard.spec.ts`), so a row is all it takes.

**Add `/\bbg-primary\/\d/` to both tables** — it catches any opacity-modified primary,
hovered or not — with a rule string naming why (fading a filled button on a dark ground
reads as disabled, not hovered).

Do it **here**, not in the docs phase, so it polices the eight fresh CLI outputs at the
exact moment they are most likely to carry stock hover classes.

Two existing hits, and they are not the same kind:

| Hit                                                                                        | Kind                                                                          | Fix                                                                                                   |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `packages/ui/src/react/badge.tsx:12` — `[a&]:hover:bg-primary/90` in the `default` variant | **A real violation, shipping today.** Stock shadcn that survived the re-skin. | Change to `hover:bg-accent-hover`, matching `button.tsx`'s `default`.                                 |
| `packages/ui/src/react/button.tsx:17` — the class named inside a docblock                  | A doc naming what it forbids                                                  | Scrub per the exact precedent of commit `a8c239b`, "stop docblocks shipping the classes they forbid". |

Finding a live violation is the argument for the guard: the rule has been in the
guidelines the whole time and the codebase drifted anyway.

Two things each generated file must **carry**, which a ban cannot express:

- a `motion-reduce:` escape on anything using `transition-*` or `animate-*`. The CLI
  writes neither, so a generated component moves for a reader who asked the OS for
  stillness and nothing else fails.
- floating surfaces reach elevation through the `--shadow-*` namespace
  (`shadow-elev-lg`), **never** an arbitrary `[box-shadow:var(--elevation-lg)]` — the
  arbitrary form overwrites the whole declaration and takes every focus ring with it.

### Sidebar tokens — aliases only, no `:root` entries, no mapping rows

The `sidebar` block ships eight `--sidebar-*` custom properties. The first draft of this
phase said to declare them in `:root` and add rows to `MAPPING` / `EDGE_MAPPING`. **That
route fails the popup surface on five tests and must not be taken.**

Why: `ownsProperty()` (Phase 1) is consulted only by the two _type_ tests. Every colour
test in `token-parity.spec.ts` is surface-blind and runs over both surfaces
unconditionally — the `MAPPING` value iteration, `declares no colour the mapping does
not account for`, `maps every colour token`, `exposes every mapped colour as a @theme
alias`, and the `EDGE_MAPPING` iteration. A `--sidebar` row means the popup is asked for
a declaration it has no reason to own. `EDGE_MAPPING` is worse: it runs `lightDarkPair()`
on the `:root` value, so `--sidebar-border: var(--surface-hairline)` fails the shape
check, and satisfying it with a duplicated `light-dark()` literal would mint a second
copy of a measured value.

**Do this instead — declare the eight as `@theme inline` aliases pointing at existing
`:root` variables.** No new `:root` declarations, no mapping rows, no new hex:

| Sidebar alias                        | Existing variable           |
| ------------------------------------ | --------------------------- |
| `--color-sidebar`                    | `var(--card)`               |
| `--color-sidebar-foreground`         | `var(--card-foreground)`    |
| `--color-sidebar-primary`            | `var(--primary)`            |
| `--color-sidebar-primary-foreground` | `var(--primary-foreground)` |
| `--color-sidebar-accent`             | `var(--accent-subtle)`      |
| `--color-sidebar-accent-foreground`  | `var(--accent-text)`        |
| `--color-sidebar-border`             | `var(--surface-hairline)`   |
| `--color-sidebar-ring`               | `var(--ring)`               |

Every target is already declared in `:root` and already carries a `light-dark()` pair
checked against the palette, so the sidebar inherits scheme correctness for free. The
existing `has no @theme alias pointing at a variable that does not exist` test verifies
each target resolves — no new test needed.

Then put the eight **alias names** in `SURFACE_ONLY` as web-owned. Phase 1's trespass
check is a whole-file name scan, so it will see them anywhere in the popup stylesheet.

The alternative — threading `ownsProperty` through all six colour tests — is honest but
is six edits to a load-bearing spec for zero extra coverage, since aliases to already
checked variables inherit their assertions.

### The CLI writes tokens somewhere, and it is not a real stylesheet

`components.json` points the CLI at `packages/ui/src/styles/globals.css`, which is a
16-line decoy: nothing imports it, and its own header records that "any token the CLI
drops here is meant to be discarded". The `sidebar` generator will drop shadcn's stock
`--sidebar-*` oklch palette into it.

**Discard those.** Leaving them in confuses a later grep into thinking the project
defines sidebar colours in two places, and they are shadcn's palette rather than this
one's.

## Related Code Files

- Create: `packages/ui/src/react/popover.tsx`, `dropdown-menu.tsx`, `avatar.tsx`, `sheet.tsx`, `tooltip.tsx`, `skeleton.tsx`, `sidebar.tsx`, `accordion.tsx`
- Create: `packages/ui/src/react/hooks/use-mobile.ts`
- Modify: `packages/ui/src/react/index.ts` — export each
- Modify: `packages/ui/src/react/skin-guard.spec.ts`, `apps/web/src/design/app-skin-guard.spec.ts` — the `bg-primary/\d` row
- Modify: `packages/ui/src/react/badge.tsx` — the live violation
- Modify: `packages/ui/src/react/button.tsx` — docblock scrub only
- Modify: `apps/web/app/globals.css` — the eight `--color-sidebar-*` aliases, in the FIRST `@theme inline` block
- Modify: `apps/web/src/design/token-parity.spec.ts` — `SURFACE_ONLY` entries only; **no** `MAPPING` or `EDGE_MAPPING` rows
- Revert: `packages/ui/src/styles/globals.css` — discard whatever the CLI drops there
- Do not regenerate: `input.tsx`, `separator.tsx`, and `button.tsx`'s variants

## Implementation Steps

1. From `packages/ui`, generate one component at a time via the shadcn CLI. For any
   name that already exists, take the `--diff` first and keep the local version.
2. Re-skin each against the table above. Grep the whole batch for the FORBIDDEN list
   before running any test — it is faster than reading the failure.
3. Add `motion-reduce:` escapes wherever a transition or animation survived.
4. Add the eight `--color-sidebar-*` aliases to `globals.css` and their `SURFACE_ONLY` entries. Discard the CLI's drops in the decoy stylesheet.
5. Add the `bg-primary/\d` row to both guards, fix `badge.tsx`, scrub `button.tsx`'s docblock.
6. Export every new component from `src/react/index.ts`, imports relative.
7. Run the package tests and the web design specs.
8. Build the package — the type build is the only thing that catches an aliased import.

## Success Criteria

- [x] `pnpm --filter @chatofy/ui test` green, `skin-guard` included
- [x] `pnpm --filter @chatofy/ui build` succeeds — proves no `@/lib/utils` import survived
- [x] `pnpm --filter web test` green, `token-parity` included
- [x] `skin-guard.spec.ts` and `app-skin-guard.spec.ts` pass — they, not a grep, are the actual check (grep cannot see docblocks)
- [x] The new `bg-primary/\d` row fails before `badge.tsx` is fixed and passes after — verify in that order, or the guard is unproven
- [x] `git diff packages/ui/src/tokens.ts` shows no hex change
- [x] `apps/extension/entrypoints/popup/theme.css` has no diff
- [x] `packages/ui/src/styles/globals.css` has no diff — the CLI's token drops were discarded
- [x] `token-parity.spec.ts` gained no `MAPPING` or `EDGE_MAPPING` row
- [x] Deliberate break: paste one `--color-sidebar` into the popup stylesheet → the trespass test fails; revert

## Risk Assessment

**The CLI overwrites an existing re-skinned primitive.** Signal: `button.tsx`,
`input.tsx` or `separator.tsx` shows up in `git status` after a generate. Response:
revert that file immediately; the local version is the correct one. Generate
one at a time precisely so this is attributable.

**Accent-once slips through.** Signal: none — no test covers it, and unlike
`bg-primary/`, "one filled control per screen" is genuinely visual. Response: partial
mechanical coverage arrives in Phase 9 as per-section render specs for the marketing
page, where sprawl actually happens; app screens stay a checklist item added in Phase 12.

**`sidebar.tsx` is large and mostly unused.** Signal: it ships context, provider, rail,
inset, menu, submenu, and skeleton variants where the app needs a rail and four items.
Response: keep the generated component intact rather than trimming it — a trimmed
shadcn component cannot be re-diffed against upstream, which is the whole reason the
project generates rather than writes. Unused exports are acceptable; `Tabs` and
`Select` already sit there with no consumer for recorded reasons.
