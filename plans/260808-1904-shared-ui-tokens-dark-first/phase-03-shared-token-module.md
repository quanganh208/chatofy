---
phase: 3
title: 'Shared token module'
status: pending
priority: P1
effort: '1.5h'
dependencies: [2]
---

## Overview

Turn `packages/ui` from a stub into a dependency-free TypeScript token module —
the single place a brand value is authored for web, extension and mobile.

## Requirements

- Functional: exports colour, spacing, radius, type and overlay token groups as plain values.
- Non-functional: no runtime dependency of any kind — no React, no DOM types, no CSS. Importable by Next, by Vite/WXT, and by Metro without configuration beyond a workspace dependency.

## Architecture

**TypeScript is the source, and there is no build step.** `packages/ui`
already resolves as TS source (`exports: { ".": "./src/index.ts" }`,
`packages/ui/package.json`), matching the `@chatofy/types` / `@chatofy/config`
convention rather than the tsup-built `@chatofy/realtime-client` one. Adding a
build here would buy nothing and cost a second package convention.

**Hex, not `oklch`.** RN 0.83 is the binding constraint; Tailwind v4 accepts hex
without complaint, so one colour space serves all three.

**Two colour groups, not one theme object.** `color` is the product palette.
`overlay` is a separate group holding the values only the meeting overlay uses —
the translucent panel background and its hairline borders, which are
deliberately `rgba()` over arbitrary video and have no meaning on web. Keeping
them apart is what stops a web design change from repainting a surface that sits
on someone else's page.

Shape (final names decided in phase 2; this is the structure):

```ts
export const color = {
  bg,
  surface,
  surfaceRaised,
  border,
  borderStrong,
  text,
  textSecondary,
  textMuted,
  accent,
  accentHover,
  accentSubtle,
  onAccent,
  live,
  liveSubtle,
  speaking,
  warning,
  warningSubtle,
} as const;

export const overlay = { bg, border, scrim } as const; // rgba(), overlay-only
export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48, '3xl': 64 } as const;
export const radius = { sm: 6, md: 10, lg: 14, full: 9999 } as const;
export const fontSize = { xs: 11, sm: 12, base: 14, md: 17, lg: 22, xl: 28 } as const;
export const fontWeight = { regular: '400', medium: '500', semibold: '600' } as const;
```

Numbers stay unitless. React Native needs numbers; the two CSS consumers append
`px` at the point of use, which is one interpolation each and cheaper than
shipping two parallel scales.

Not exported, and the reason belongs in a comment: the overlay's `z-index` and
its font stack. Both are overlay-local, and an overlay that inherits the page's
font gains an injection surface it does not need.

## Related Code Files

- Create: `packages/ui/src/tokens.ts`
- Modify: `packages/ui/src/index.ts` — replace the placeholder comment with the re-export
- Modify: `packages/ui/README.md` — the package is now tokens, and states why it is not components

`packages/ui/package.json` is deliberately **not** modified: no test lands here
(the parity test lives in `apps/web`, see phase 4) and the package stays
dependency-free.

## Implementation Steps

1. Write `packages/ui/src/tokens.ts` with the groups above, values from `docs/design-guidelines.md`. Every entry carries a short comment naming its role, not its colour.
2. Re-export from `packages/ui/src/index.ts`, replacing the "Do not add yet" placeholder.
3. Rewrite `packages/ui/README.md`: this package holds tokens; components are still refused, and the reason is that web has two primitives, the extension has no React by design, and mobile has no screens — restate the YAGNI trigger rather than deleting it.
4. Keep `packages/ui/package.json` dependency-free. Do not add React, `@types/react`, or any CSS tooling.
5. Run `pnpm --filter @chatofy/ui typecheck`.

## Success Criteria

- [x] `packages/ui` declares zero runtime dependencies
- [x] `tokens.ts` contains every value from `docs/design-guidelines.md` and nothing more
- [x] `overlay` is a separate export from `color`
- [x] No `z-index` and no font stack in the package
- [x] `space` carries the `'3xl': 64` step mobile already uses
- [x] `packages/ui/package.json` still declares zero dependencies and no test script
- [x] `pnpm typecheck` clean

## Risk Assessment

- **A component sneaks in later and drags React into the package**, breaking Metro. Signal: a `.tsx` file or a React dependency in `packages/ui`. Response: components go behind a `@chatofy/ui/react` subpath export so RN never resolves DOM code — decided now, so nobody has to decide it under pressure.
- **Unitless numbers get interpolated without `px`** and silently produce invalid CSS. Signal: a rule that does not apply in the browser. Response: the two CSS consumers each own one helper that appends the unit; do not scatter interpolation.
