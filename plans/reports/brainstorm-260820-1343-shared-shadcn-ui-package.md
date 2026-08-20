# Brainstorm — shadcn/Radix in a shared UI package

Request: setup shadcn + Radix in `packages/ui`, all components, shared by
`apps/extension` and `apps/web`.

Status: exploration. No workspace mutation. Feeds a plan.

## Contract

**Outcome.** `packages/ui` ships real shadcn components (Radix behaviour, cva
variants, `cn`) behind a `@chatofy/ui/react` subpath. `apps/web` and the
`apps/extension` popup both render from that one set. Neither app keeps a
private copy of a primitive the package owns.

**Constraints** (all verified in source, not assumed):

- `packages/ui` root export must stay zero-dependency. README Constraints:
  "No dependencies. Not React, not `@types/react`, not CSS tooling. Metro has to
  import this." `apps/mobile/src/ui/theme.ts` imports it directly.
- The overlay cannot take Tailwind. `src/overlay-invariants.spec.ts:71` asserts
  `expect(STYLE).not.toContain('var(')`; Tailwind v4 emits `var(--color-*)` for
  every themed utility. `:host { all: initial }` does not reset custom
  properties, so a var-themed overlay is repaintable by the meeting page — that
  is the reason the rule exists, and it is a security property, not a style
  preference.
- `packages/ui` runs `prepare: tsup` because `wxt prepare` resolves its entry at
  install time on a clean checkout. Anything added to the package is built on
  every fresh `pnpm install`.
- Three bundlers read the package: Next, Vite via WXT, Metro. Dual CJS+ESM today.
- `token-parity.spec.ts` and `token-contrast.spec.ts` currently enforce the
  palette. They must keep passing.

**Non-goals.**

- The meeting overlay (869 lines, `entrypoints/content/`). Stays hand-written
  CSS-in-string. Structural, see above.
- `apps/mobile`. React Native; a DOM component cannot be one of its screens.
- Retiring the token package's root export. It keeps serving overlay + mobile.

**Acceptance criteria.**

1. `@chatofy/ui` root import still resolves with zero runtime deps; mobile
   typechecks and builds unchanged.
2. `@chatofy/ui/react` exports every primitive both DOM apps use; no `ui/`
   component file remains under `apps/web/src/components/ui/`.
3. Extension popup renders from the same package; `popup-style.spec.ts` either
   passes or is replaced by an equivalent guard on the new mechanism.
4. `overlay-invariants.spec.ts` unchanged and green — proves the overlay was not
   dragged in.
5. `token-parity` + `token-contrast` green — proves the palette survived.
6. `turbo lint typecheck test build` green; extension e2e 46/0.

## Surface map

| Surface           | Runtime                                        | shadcn?                            | Why                                                  |
| ----------------- | ---------------------------------------------- | ---------------------------------- | ---------------------------------------------------- |
| `apps/web`        | Next 16, React 19, Tailwind v4                 | yes                                | `@theme inline` already labelled "shadcn-compatible" |
| extension popup   | vanilla HTML + injected CSS string             | yes, after adding React + Tailwind | ordinary extension page, ordinary CSP                |
| extension overlay | closed shadow root, `all: initial`, no `var()` | **no**                             | Tailwind v4 is var()-based end to end                |
| `apps/mobile`     | Expo / React Native                            | **no**                             | DOM                                                  |

"Shared by extension and web" therefore lands on 2 of 4 surfaces. The extension
stays half hand-written. Worth saying out loud before the work starts.

## Findings that change the shape

**1. `accent` means opposite things in the two systems.** shadcn `--accent` is
the subtle grey hover surface (`hover:bg-accent` on ghost buttons, dropdown
items, menu items). Chatofy "accent" is the brand blue: `--accent-hover`,
`--accent-text`, `--accent-subtle`, and `--primary` is the blue.

There is no bare `--color-accent` in `globals.css`. So a stock shadcn component
dropped in today does not paint blue — Tailwind never generates the class, and
those elements get **no hover at all**. Silent, and invisible in a screenshot of
the resting state. Same for `bg-popover` / `text-popover-foreground`, also absent.

Missing aliases to add: `--color-accent`, `--color-accent-foreground`,
`--color-popover`, `--color-popover-foreground`.

**2. The type scale diverges deliberately.** `globals.css` refused to override
`--text-xs`…`--text-xl` — token `sm` is 12 against Tailwind's 14, `lg` is 22
against 18, and overriding silently re-typesets every existing `text-sm` in the
app. Role names were used instead: `text-label/hint/body/translation/heading/title`.
Stock shadcn uses `text-sm` throughout. Adopting it unedited puts two type
scales in one app.

**3. ~1076 lines of components were hand-tuned to this palette across 29 commits
on this branch**, with contrast ratios recorded in `docs/design-guidelines.md`.
Replacing them with stock shadcn discards that tuning unless each is re-skinned.

**4. `"use client"` through tsup.** `segmented-control`, `status-indicator`,
`theme-toggle` carry the directive. Bundlers routinely hoist it away from the top
of the chunk; Next then treats the module as a server component and the build
fails at first hook. Needs `banner` config or `preserveDirectives`, and a test
asserting the directive survives into `dist`.

## Approaches

**A — chatofy tokens win; shadcn supplies structure.** Add the four missing
token aliases mapped to chatofy values; generate components with the CLI, then
re-skin `text-sm` → `text-body`/`text-hint` and any stock colour to the product
token. Radix behaviour, cva variants and composition come in as-is.
_Depends on:_ re-skinning being find/replace per component, not rewrite.
_Fails first when:_ a component's stock markup encodes a size relationship the
role scale has no step for. Verify on Button before committing.

**B — shadcn stock wins.** Adopt shadcn's full token set and Tailwind's default
type scale; chatofy palette maps onto shadcn slots; role scale retired.
_Depends on:_ nobody minding the app re-typesetting.
_Fails first when:_ `docs/design-guidelines.md` and the two token specs have to
be rewritten to match a scale chosen elsewhere — the measured contrast work
becomes unverifiable against its own document.

**C — two layers.** Package holds stock shadcn; each app wraps thinly with
product tokens.
_Depends on:_ wrappers staying thin.
_Fails first when:_ the wrapper layer grows into the thing the package was
supposed to remove — two component sets instead of one, which is the duplication
this request exists to end.

## Recommendation

**A.** It satisfies the request in full — all components, one shared package,
real Radix — without discarding the palette work that two specs currently
enforce. It is also the cheapest to abandon: if re-skinning turns out to fight
the components, B is still reachable from A, while A is not reachable from B
once the role scale is gone.

Sequence: subpath + build plumbing (with the `"use client"` test) → Button as the
skinning probe → remaining web primitives → Tailwind + React into the extension
popup → popup rewrite → delete the private copies.

## Unresolved

1. Extension popup bundle: currently 335KB total, no framework. React + Radix
   Select alone lands ~150KB+. Acceptable, or is popup weight a constraint?
2. `main.ts` is 419 lines of imperative DOM plus a documented "no UI framework"
   decision in `wxt.config.ts`. Rewriting it is the largest single piece of this
   work and carries the regression risk. Rewrite now, or land the package for web
   first and bring the popup in a second pass?
3. Which primitives does the popup actually need — Select, Checkbox, Button,
   plus the notice/fieldset patterns? Determines how much of shadcn gets pulled.
4. `docs/design-guidelines.md` and `packages/ui/README.md` both currently argue
   components do **not** belong in this package. Both need rewriting as part of
   this, not after.
