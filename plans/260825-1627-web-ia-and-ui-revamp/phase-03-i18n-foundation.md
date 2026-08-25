---
title: 'Phase 3: i18n foundation'
status: todo
priority: P1
dependencies: [2]
---

# Phase 3: i18n foundation

## Overview

Stand up `packages/i18n` with an **English-only** dictionary, `t()`, and the React
provider — before any surface is built. Every component from Phase 4 onward writes
dictionary keys natively instead of string literals, so Phase 10 fills in Vietnamese
rather than rewriting the app.

Nothing user-visible changes. English renders exactly as it does today.

## Why this sits here and not at the end

The first draft of this plan put all i18n work in one late phase. That would have meant
every component built in the surface phases gets rewritten at the most fatigued point of
the branch — ~250 keys, seven spec rewrites, a provider, and locale negotiation, all at
once, with the phase's own admission that grep is not a completeness gate.

Keys are stable even while copy is still being designed against the mockup. Writing them
from the start costs almost nothing per component and removes the rewrite entirely.

## Requirements

- [ ] `packages/i18n` builds and is consumable from `apps/web`
- [ ] `MessageKey` is derived from the English dictionary so a missing key is a compile error
- [ ] A provider and a `t()` usable from server and client components
- [ ] Existing web strings are migrated to keys with **no rendered change**

## Architecture

### Packaging — follow the repo convention, do not invent one

`packages/types` and `packages/ui` both build with tsup to `dist` and declare an
`exports` map. Do the same. The alternative — shipping raw TS — requires adding
`@chatofy/i18n` to `transpilePackages` in `next.config.ts`, and that array currently
holds only `@chatofy/types` and `@chatofy/config`. Following the tsup convention means
turbo's `dependsOn: ["^build"]` already covers it and knip picks the workspace up from
the `packages/*` glob with no config entry.

**Zero runtime dependencies, no React, no DOM types** — same constraints as `tokens.ts`,
and for the same reason: Metro must be able to import it and the extension popup must be
able to. The React provider lives in `apps/web`; a `/react` subpath is its future home
if a second DOM surface adopts, mirroring `@chatofy/ui/react`.

### Parity by compiler

```ts
export const en = {
  'common.theme.light': 'Light',
  'web.auth.signIn': 'Sign in',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
```

Phase 10 adds `export const vi: Messages = { … }` and `tsc` fails on any missing key.
That is the same parity-by-construction the repo trusts in `token-parity`, except the
compiler is the spec and no test needs writing.

Namespaces by surface: `common.*` for vocabulary shared with the popup one day (theme
labels, language names), then `web.chrome.*`, `web.landing.*`, `web.app.*`,
`web.translate.*`, `web.auth.*`. Keys name **what is said**, never where it sits.

### `t()`

~30 lines: look up the key, interpolate `{name}` placeholders, return the key itself if
lookup fails so a missing string is visible rather than blank. No ICU: Vietnamese has no
grammatical plural, so plural machinery would serve only the English half of a handful of
strings — write those two variants by hand when they appear.

### The provider

A locale is resolved once, server-side, and passed down. In this phase it is always
`'en'` — the cookie read, `Accept-Language` negotiation and the switcher all arrive in
Phase 10. Building the seam now means Phase 10 changes _how the locale is resolved_, not
_how strings are read_.

### `packages/ui` carries English today

`theme-toggle.tsx` hard-codes `'Light'`, `'Dark'`, `'Match system'` and
`aria-label="Colour theme"`, and it is rendered by the extension popup as well as web.

Fix it the shared package's own way — **compositions are controlled**: optional label
props defaulting to today's English strings. Web passes localized labels down; the popup
keeps working with zero changes.

## Related Code Files

- Create: `packages/i18n/package.json`, `tsup.config.ts`, `tsconfig.json`, `src/index.ts`, `src/en.ts`, `src/t.ts`
- Create: `apps/web/src/i18n/provider.tsx`, `src/i18n/use-translate.ts`
- Modify: `apps/web/package.json` — add the workspace dependency
- Modify: `packages/ui/src/react/theme-toggle.tsx` — optional label props
- Modify: existing web components — literals become keys, values unchanged
- Read only: `packages/types/package.json`, `packages/ui/tsup.react.config.ts` — the conventions to copy

## Implementation Steps

1. Scaffold `packages/i18n` copying the tsup + exports-map shape from `packages/types`.
2. Write `en.ts` with the strings that exist in web today, namespaced.
3. Write `t()` with `{name}` interpolation and key-as-fallback.
4. Add the provider and hook in `apps/web`.
5. Give `ThemeToggle` label props defaulting to English.
6. Migrate existing web components from literals to keys. **Rendered output must not
   change** — this is a refactor, and its whole safety property is that the existing
   specs still pass untouched.
7. Run the full suite.

## Success Criteria

- [ ] `pnpm --filter @chatofy/i18n build` succeeds
- [ ] `pnpm --filter web test` green **with the seven copy-asserting auth specs unmodified** — that is the proof no rendered string changed
- [ ] `pnpm --filter @chatofy/ui test` green; the popup renders unchanged English
- [ ] Deliberate break: add a key to `en` used with `t()` and typo the call site → `tsc` fails
- [ ] `packages/i18n` has zero runtime dependencies
- [ ] `git diff apps/web/next.config.ts` is empty — proving the tsup route avoided `transpilePackages`
- [ ] `pnpm -w build` green from a clean `dist`

## Risk Assessment

**The refactor changes a rendered string by accident.** Signal: one of the seven auth
specs fails. Response: that is the guard working — those specs assert literal English and
are deliberately left untouched in this phase precisely so they act as the regression net.
They only get repointed at the dictionary in Phase 10.

**Key naming rots immediately.** Signal: keys like `web.text12`, or keys named after
their position. Response: keys name what is said. Review the namespace once at the end of
this phase, while there are ~100 and renaming is cheap.

**Server/client split on the provider.** `@chatofy/ui/react` carries a blanket
`"use client"` banner; `packages/i18n` must not, or every server component reading a
string becomes a client reference. Signal: Next refusing a server component that imports
it. Response: `packages/i18n` is plain data and functions with no banner — that is why
the provider lives in the app, not the package.
