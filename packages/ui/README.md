# @chatofy/ui

Design tokens — colour, spacing, radius, type — shared by `apps/web`,
`apps/extension` and `apps/mobile`. The reasoning behind every value, including
the measured contrast ratios, is in [`docs/design-guidelines.md`](../../docs/design-guidelines.md).

## Tokens, not components

Three apps had three unrelated palettes: stock shadcn grayscale in web, hardcoded
zinc/red/amber in the extension overlay, and Apple's system colours in mobile.
That is the duplication worth removing, and it is data rather than markup.

Components are still refused, and the reason has not changed since this package
was a stub:

- `apps/web` has two primitives of its own (`button.tsx`, `card.tsx`).
- `apps/extension` runs with no UI framework on purpose — see the note in
  `apps/extension/wxt.config.ts`. Its overlay lives in a closed shadow root that
  Tailwind's stylesheet does not reach, and MV3's CSP forbids the `eval` a
  framework build pulls in.
- `apps/mobile` has no screens yet.

So there is nothing a shared component could be shared _with_. If one ever
belongs here it goes behind a `@chatofy/ui/react` subpath export, so React Native
never resolves DOM code.

## Constraints

- **No dependencies.** Not React, not `@types/react`, not CSS tooling. Metro has
  to import this.
- **Hex, not `oklch`.** React Native's colour parsing is the binding constraint.
- **Unitless numbers.** React Native requires them; the CSS consumers append the
  unit where they interpolate.
- **No `z-index`, no font stack.** Both are surface-specific — see the note on
  the `overlay` export.

## Consumers

| App              | How                                                                  | Kept honest by                                                |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| `apps/web`       | values hand-written into `app/globals.css` as custom properties      | `src/design/token-parity.spec.ts` fails when the two disagree |
| `apps/extension` | interpolated as **literal values** into the overlay's `STYLE` string | —                                                             |
| `apps/mobile`    | imported directly by `src/ui/theme.ts`                               | —                                                             |

The extension takes literals rather than CSS variables deliberately:
`:host { all: initial }` does not reset custom properties, so a variable-themed
overlay is repaintable by the meeting page it sits on.
