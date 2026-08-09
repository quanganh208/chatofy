---
phase: 4
title: 'Web token wiring'
status: pending
priority: P1
effort: '2.5h'
dependencies: [3]
---

## Overview

Repoint `apps/web/app/globals.css` from the stock shadcn grayscale to the brand
palette, switch the site to dark, and add the one test that keeps CSS and
TypeScript from drifting.

## Requirements

- Functional: existing components pick up the new palette with no changes to their class names.
- Non-functional: a test fails when `globals.css` and `tokens.ts` disagree. No codegen, no build step, no new devDependency beyond the workspace token package.

## Architecture

**The site is currently light, not dark.** `apps/web/app/layout.tsx:15` renders
`<html lang="en">` with no `dark` class, so the entire `.dark` block in
`globals.css` is dead code and has never applied. Two consequences the plan must
carry honestly:

- Deleting `.dark` breaks nothing.
- The visible event in this phase is **adding** `className="dark"`, which is a
  full light→dark inversion, not "a colour change". Review it as such.
- Adding the class also **activates** every previously-dead `dark:` utility.
  There is exactly one in the app — `dark:text-amber-500` at
  `live-panel.tsx:138` — so the blast radius is one line, but grep because they
  are being switched **on**, not because a block is going away.

**Keep the shadcn semantic variable names.** `button.tsx` and `card.tsx` already
reference `--color-primary`, `--color-muted-foreground`, `--color-border`, and
the `@theme inline` block already maps them. Renaming would touch every
component for no gain. This phase changes **values**, not names — which is why
it is small and phase 5 is large.

**Respect the existing two-level variable split.** The convention is a raw value
on `:root` (`--destructive: …`) and an alias in `@theme inline`
(`--color-destructive: var(--destructive)`). New state variables follow it:
`--live` / `--color-live`, `--speaking` / `--color-speaking`, `--warning` /
`--color-warning`, plus the two subtle variants. Declaring `--color-live`
directly in `:root` _and_ in `@theme` would have Tailwind emit its own `:root`
declaration for the same name, and one would silently win.

`--destructive` stays and takes the same hex as `live`. They are different
meanings that happen to share a colour; merging them would make a future
divergence a rename.

**Translucent borders become opaque.** The current dark block uses
`--border: oklch(1 0 0 / 10%)` and `--input: oklch(1 0 0 / 15%)`. Replacing them
with an opaque `#26282D` changes how card edges render over any surface that is
not `bg`. Intended — but it is a visual delta, not a no-op.

**The parity test lives in `apps/web`, not `packages/ui`.** `apps/web` already
has vitest configured with `environment: 'node'` and
`include: ['src/**/*.spec.ts']`, so reading `app/globals.css` with `fs` is
native. Putting the test in `packages/ui` would mean a new vitest dependency, a
new config, and a new turbo `test` target on a package that has no tests.

Because the environment is node, this is a **text** parity test — it can never
assert computed CSS. The hand-written mapping table is therefore doing all the
work, and it must cover **every** brand variable in `globals.css`, not only the
new ones. An inferred mapping would pass while mapping the wrong things to each
other; a partial table would let `--ring`, `--input` and `--secondary` drift
unnoticed.

**`transpilePackages` is not needed yet.** Nothing under `app/` or `src/`
imports `@chatofy/ui` at runtime — only the test does, and vitest resolves the
workspace TS source itself. Add `'@chatofy/ui'` to `apps/web/next.config.ts`
the moment phase 5 introduces a runtime import; Next fails the build loudly, so
that failure mode is cheap.

Note the deliberate asymmetry: web takes `@chatofy/ui` as a **devDependency**
(test-only), extension and mobile take it as a **dependency** (shipped). Say so
in the diff, or someone will "fix" it.

## Related Code Files

- Modify: `apps/web/app/globals.css` — token values, `:root` dark, new state variables
- Modify: `apps/web/app/layout.tsx` — `className="dark"`, `color-scheme: dark`, display font
- Modify: `apps/web/package.json` — add `@chatofy/ui` as a workspace devDependency
- Modify: `apps/web/src/components/translate/live-panel.tsx` — the one `dark:` utility, repointed at `--color-warning`
- Create: `apps/web/src/design/token-parity.spec.ts`
- Modify (conditional): `apps/web/next.config.ts` — only if a runtime import appears

## Implementation Steps

1. Add `"@chatofy/ui": "workspace:*"` to `apps/web/package.json` devDependencies; `pnpm install`.
2. Rewrite the `:root` block with the brand hex values. Set `--primary` to the accent (`#6E56CF`) and `--primary-foreground` to `onAccent` — the single change that removes the grayscale look from every existing button.
3. Delete the `.dark` block. Leave `@custom-variant dark` in place with a comment saying light is deferred, not removed.
4. Add the state variables as raw `:root` values plus `@theme inline` aliases, following the existing two-level split.
5. In `layout.tsx`, add `className="dark"` to `<html>` and set `color-scheme: dark` so form controls and scrollbars match. Wire the display font through `next/font` so it is self-hosted rather than fetched at runtime.
6. Repoint `live-panel.tsx:138` from `text-amber-600 dark:text-amber-500` to the warning token — it is now live for the first time.
7. Write `apps/web/src/design/token-parity.spec.ts`: read `app/globals.css` as text, parse `--<name>: <value>;` pairs, and assert against an explicit `Record<cssVarName, tokenValue>` table built from `@chatofy/ui`. Assert both directions — every mapped variable exists in the CSS, and every brand value in the CSS is accounted for. The table must cover all existing variables, including `--ring`, `--input` and `--secondary`.
8. Verify the test is not a tautology by hand-breaking one hex and watching it fail.
9. Run each command separately: `pnpm --filter web test`, `pnpm --filter web typecheck`, `pnpm --filter web lint`, `pnpm --filter web build`. They cannot be chained as arguments — only the first token is the script name.

## Success Criteria

- [x] `globals.css` contains no `oklch(... 0 0)` grayscale brand value
- [x] Every brand variable in `globals.css` appears in the parity table
- [x] `token-parity.spec.ts` fails when a single hex is edited — confirmed by hand
- [x] `<html>` carries `dark` and `color-scheme: dark`; the site actually renders dark
- [x] The one `dark:` utility was reviewed now that it applies for the first time
- [x] `pnpm --filter web test`, `typecheck`, `lint`, `build` each pass
- [x] `transpilePackages` untouched unless a runtime import was actually added

## Risk Assessment

- **Reviewed as "a colour change" when it is a light→dark inversion.** Signal: a reviewer approving on the diff alone. Response: the PR carries before/after screenshots of `/translate` in both modes; that is the review artifact, not the CSS diff.
- **The parity test asserts a tautology.** Signal: it stays green after editing `globals.css`. Response: step 8 is the guard and is not optional.
- **Contrast regressions.** Signal: 11px uppercase labels reading as noise on `surface`. Response: phase 2 computes the actual ratios for `textMuted` / `textSecondary` / `text` against both `bg` and `surface` and records them in `docs/design-guidelines.md`; this phase applies that table rather than eyeballing it.
- **Opaque borders change card edges** over non-`bg` surfaces. Signal: cards reading as heavier than intended. Response: intended; adjust `borderStrong` usage rather than reintroducing translucency, which would be a value the token module cannot express as one hex.
