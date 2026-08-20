# @chatofy/ui

Design tokens — colour, spacing, radius, type — shared by `apps/web`,
`apps/extension` and `apps/mobile`. The reasoning behind every value, including
the measured contrast ratios, is in [`docs/design-guidelines.md`](../../docs/design-guidelines.md).

## Tokens, not components

Three apps had three unrelated palettes: stock shadcn grayscale in web, hardcoded
zinc/red/amber in the extension overlay, and Apple's system colours in mobile.
That is the duplication worth removing, and it is data rather than markup.

Components used to be refused as well, for three reasons. Two of them still hold,
word for word:

- `apps/extension`'s **overlay** lives in a closed shadow root that Tailwind's
  stylesheet does not reach, and MV3's CSP forbids the `eval` a framework build
  pulls in. Both halves are still true, and the second is now held by a gate
  rather than by abstinence — see the note in `apps/extension/wxt.config.ts` and
  the two scripts it names. The overlay keeps its hand-written string.
- `apps/mobile` has screens — conversation, history, settings and the auth pair —
  but they are React Native. A DOM component cannot be one of them, and a
  component abstract enough to be both is a framework, not a primitive.

The third reason was "a shared component would have at most one consumer", and
that is the one that stopped being true. `apps/web` and the extension's **popup**
are both ordinary DOM surfaces rendering React, and they were drawing the same
controls twice — a theme switcher, an alert with two severities, a button. They
now render from `@chatofy/ui/react`, which is where the subpath this file
anticipated actually went.

So the boundary is no longer components-versus-tokens. It is which surface:

| Surface                      | Renders from        | Why                                          |
| ---------------------------- | ------------------- | -------------------------------------------- |
| `apps/web`                   | `@chatofy/ui/react` | ordinary DOM                                 |
| `apps/extension` **popup**   | `@chatofy/ui/react` | ordinary DOM, extension page                 |
| `apps/extension` **overlay** | hand-written string | closed shadow root on a page it does not own |
| `apps/mobile`                | tokens only         | React Native                                 |

The root entry is still tokens only, and that has become more important rather
than less: it is what keeps Metro from ever resolving a component.

## Why there is a `prepare` script

`apps/extension` runs `wxt prepare` as its own `postinstall`, and that resolves
the entry of every package its entrypoints import — including this one, whose
`exports` point at `dist`. On a clean checkout `dist` does not exist yet, so the
install fails before any build has had a chance to run. `prepare` is pnpm's
answer: it builds a workspace package as part of linking it.

This does not reproduce on a machine that has already built once, which is
exactly why it reached CI. A detached worktree plus `pnpm install --frozen-lockfile`
is the way to see it.

## Constraints

- **No dependencies on the root entry.** Not React, not `@types/react`, not CSS
  tooling. Metro imports `@chatofy/ui` directly for `apps/mobile`, and everything
  it can reach from there has to survive Hermes.

  The `@chatofy/ui/react` subpath is the exception the rest of this file
  anticipated, and it is exempt from all of the above: Radix, `clsx`, `cva`,
  `tailwind-merge` and `lucide-react` are real dependencies of it, with React
  itself a peer. Metro never resolves a subpath nobody asks for by name, so the
  constraint above is preserved by construction rather than by discipline —
  `src/root-export.spec.ts` walks the root barrel's import graph and fails on the
  first bare specifier.

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
