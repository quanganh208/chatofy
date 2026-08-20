# Phase 6 — React and Tailwind into the popup

Branch `feat/production-ui-ux`. Toolchain only; no rewrite. `main.ts` untouched.

## What the build actually does

`@wxt-dev/module-react` + `@tailwindcss/vite` wired in `wxt.config.ts`. React and
Tailwind reach the popup because the module rewrites Vite's config for HTML
entrypoints; the content script is not one.

**Content-script CSS mechanism — verified, not assumed.** Planted
`import './probe.css'` in `entrypoints/content/index.ts`, built, read the manifest:

|                          | clean  | with the import                   |
| ------------------------ | ------ | --------------------------------- |
| `content_scripts[0].css` | absent | `["content-scripts/content.css"]` |
| `content-scripts/*.css`  | none   | `content.css`, 9.04 kB            |

Both halves fire together on this WXT version. The guard asserts both anyway — a
future WXT could emit one without the other.

## Guards

`apps/extension/scripts/verify-content-script-css.mjs` and
`verify-mv3-csp.mjs`, wired to `pnpm verify:build`. The turbo task already
depends on `build` without the caret, and CI already runs `pnpm turbo run
verify:build`, so no workflow change.

Each proven in three states:

| guard              | clean | mutated                              | `.output` absent |
| ------------------ | ----- | ------------------------------------ | ---------------- |
| content-script CSS | pass  | fail, both clauses                   | fail             |
| MV3 CSP grep       | pass  | fail (`new Function` in popup chunk) | fail             |
| e2e CSP listener   | pass  | fail (`(0, eval)`)                   | n/a              |

**The plan's `var(--color-` guard stays dead** — already disproven before this
phase. Replaced by the structural manifest check as the phase file directed.

### The CSP listener was vacuous on first write

Watching `page.on('console')` only, it stayed **green** through a planted
`(0, eval)` while nine other checks went red. A refused string-compile _throws_,
so it arrives as `pageerror`, never as a console message. Fixed by watching both.

### And the exempt shape is covered by neither — deliberately

The grep exempts a string-compile inside `try`/`catch`. Zod v4 ships exactly one
(`allowsEval`, reached through `@chatofy/types`), and it is pre-existing in
`background.js`, `inject.js` and the shared chunk.

Planted `try { globalThis.__probe = new Function("") } catch {}`, confirmed it
survived bundling and ran — Chrome surfaced **neither** a page error nor a console
message. So the exemption is not "covered elsewhere", it is "not a defect": a
compile whose failure is already handled cannot break anything. Both comments were
rewritten; the first draft of each claimed e2e covered it, which was false.

## The cascade, which is where the phase actually went

`.bg-primary` was generated and did not apply. Tailwind puts utilities in
`@layer utilities`; `styles.ts` is injected unlayered, and **an unlayered
declaration beats a layered one at any specificity**. Its bare `button { }`
outranked `.bg-primary` — a Button holding one background across both themes while
every token around it flipped correctly.

**Layering `styles.ts` was tried and is worse on this surface.** With
`@layer legacy` ordered between `base` and `utilities`, `display: flex` and
`max-height` from the same rule applied but `body`'s `font` did not — 14px/system-ui
became 12px/system font. Chased it to the end:

- exhaustive enumeration: the _only_ author rule setting `body`'s font is that one
- disabling the whole Tailwind sheet changed nothing
- a layered `body { font-size: 14px }` lost; an unlayered one won

Chrome applies its own defaults to an extension page from a stylesheet that is
unlayered and **absent from `document.styleSheets`**. Anything put in a layer drops
below an adversary the page cannot show you.

**Shipped instead:** `styles.ts` stays unlayered, and `theme.css` expands
`@import 'tailwindcss'` into its three parts leaving utilities unlayered. Both
sides unlayered, specificity decides, class beats element.

## Preflight impact — measured

Computed-style census of all 76 popup elements, consent dismissed so the settings
pane is laid out, vanilla build vs this one.

**Rendered boxes moved: 1 of 76.** `main#settings` 426px → 365px — exactly the
61px the probe strip occupies. It leaves with the probe in Phase 7.

Everything else is inert: `border-style: none → solid` at `border-width: 0`;
`box-sizing` reported as border-box; `font: inherit` on checkboxes, which render no
text. `<html>`/`<head>` font changes never reach `body`, which sets its own.

One property is run-to-run noise, not a regression: `#consent-ok`'s background
differs between two runs of the _same_ build — the harness clicks it and the hover
state is a coin flip.

## Button tokens — measured, both themes

|                 | light                 | dark       |
| --------------- | --------------------- | ---------- |
| background      | `#2f4ce0`             | `#7a90f5`  |
| foreground      | `#ffffff`             | `#0b1030`  |
| radius          | 10px (`--radius` − 4) | 10px       |
| weight / height | 500 / 36px            | 500 / 36px |

First read said dark was still light — `transition-colors`, sampled at t=0.

## Bundle

|                                    | raw       | gzip         |
| ---------------------------------- | --------- | ------------ |
| vanilla popup                      | 34.6 kB   | 12.4 kB      |
| with React + Tailwind + one Button | 285.7 kB  | **87.1 kB**  |
| delta                              | +251.1 kB | **+74.7 kB** |

Estimate was 65–70 kB gzip for the toolchain; actual **74.7**, ~7% over. The
`@chatofy/ui/react` entry is one bundle with `splitting: false`, so importing
`Button` pulls every component — Radix RadioGroup, Select, Checkbox, lucide. Phase 7
uses most of them, so this is close to the end-state cost rather than waste. The
12.4 kB vanilla half goes away in Phase 7.

## Gates

`turbo lint typecheck test build` 28/28 · `verify:build` 10/10 · extension e2e
**56/0** (was 55; +1 CSP check) · packages/ui 20 · web 161 · knip at baseline.

`overlay-invariants.spec.ts` unmodified and green.

## Also cleaned

`apps/web` carried four dependencies knip flagged, three genuinely dead since
Phase 5 moved components into `packages/ui`: `@radix-ui/react-slot`,
`class-variance-authority`, `@testing-library/react` — removed. `tw-animate-css` is
a false positive, imported by `globals.css`; added to knip's ignore list with the
reason.

## Unresolved

- `Button` sets no font-size — the skin bans `text-sm` in favour of the role-based
  scale, so it inherits. Renders 14px in the popup. Whether that is intended across
  both surfaces is a Phase 8 question.
- Zod's `allowsEval` probe runs in shipped code and gets refused. Harmless, but
  `z.config({ jitless: true })` would remove a dead branch. Not done: pre-existing,
  and it needs a module every entrypoint imports first.
- The service worker's console is unwatched — Playwright gives no handle. Covered
  by the build-time grep only.
