---
phase: 6
title: 'Extension overlay restyle'
status: pending
priority: P1
effort: '3h'
dependencies: [1, 3]
---

## Overview

Repoint the overlay's `STYLE` constant at the shared tokens so the meeting
overlay and web read as one product — changing only the contents of a string
that is already delivered the same way.

## Requirements

- Functional: overlay colours come from `@chatofy/ui`; the transcript gains the same hierarchy web got in phase 5.
- Non-functional: the style delivery mechanism does not change, no CSP delta, `pnpm --filter extension test` and `test:e2e` pass, phase 1's isolation hardening survives.

## Architecture

**Literal values, never CSS custom properties.** This is the load-bearing
decision of the phase. `:host { all: initial }` does not reset custom
properties — they cross the shadow boundary deliberately, as a public styling
interface — so an overlay themed with `var(--chatofy-*)` is repaintable by the
meeting page, including the capture indicator that is not allowed to be
hideable. Tokens are interpolated into the template literal at build time:

```ts
import { color, overlay, radius } from '@chatofy/ui';

const STYLE = `
  :host { all: initial !important; ... }
  .panel { background: ${overlay.bg}; border: 1px solid ${overlay.border}; border-radius: ${radius.md}px; }
  .indicator { background: ${color.live}; }
  ...
`;
```

**The delivery mechanism does not change.** `style.textContent = STYLE` at
`apps/extension/entrypoints/content/index.ts:211` stays exactly as it is.
Introducing `adoptedStyleSheets`, a constructed `CSSStyleSheet`, a fetched
`.css`, or `web_accessible_resources` would each be a new mechanism with new
failure modes on the strict-CSP pages this ships onto — and WAR is not even
available here (`apps/extension/wxt.config.ts` records that Chrome requires a
WAR path of exactly `/*`, which `https://*.zoom.us/wc/*` cannot satisfy).
Changing only the _string contents_ is a zero-delta CSP change.

**No `prefers-color-scheme`, ever.** Inside a content script it reflects the OS,
not the page. A light-OS user in a dark Meet would get a white panel over video.
The overlay is permanently dark; that is why `overlay.*` is a separate token
group.

**`z-index: 2147483647` and the font stack stay literal in this file**, not
imported. Both are overlay-specific, and a font inherited from the page is an
injection surface.

## Related Code Files

- Modify: `apps/extension/entrypoints/content/index.ts` — `STYLE` contents only, plus the transcript markup changes from step 4
- Modify: `apps/extension/package.json` — add `@chatofy/ui` as a workspace dependency
- Modify: `apps/extension/entrypoints/popup/index.html` — the `.warn` / `#notice` / `#mic` colours only (full popup restyle is phase 8)
- Verify: `apps/extension/e2e/run.mjs` still passes unchanged apart from phase 1's addition

## Implementation Steps

1. Add `"@chatofy/ui": "workspace:*"` to `apps/extension/package.json`; `pnpm install`.
2. Import `color`, `overlay`, `radius`, `space`, `fontSize` and interpolate them into `STYLE`. Every hardcoded hex and rgba in that constant goes; `z-index` and the font stack stay.
3. Map the existing semantic classes onto the new state tokens: `.indicator` → `live`, `.error` → `warning` + `warningSubtle`, `.outbound` → `accentSubtle`, `.who` → `accent`, `.source` → `textMuted`, `.target` → `text`. `.outbound` stays on the accent deliberately: it reports a persistent **mode** ("your speech is being translated into the meeting"), not a transient event, and `speaking` is reserved for a translation actually playing. The existing comment already insists it must not be dressed as an error; the accent satisfies that without borrowing the state colour.
4. Bring the transcript in line with phase 5: same settled/live distinction, same speaker-side treatment (`.line.mine` already has the idea), same spacing rhythm scaled down for a 340px panel.
5. Restyle the popup's three coloured boxes (`.warn`, `#notice`, `#mic`) with the same state tokens so the two extension surfaces stop disagreeing with each other. Leave the rest of the popup for phase 8.
6. Confirm the `@media (prefers-reduced-motion: reduce)` rule on `.dot` survives, that no new animation is added without one, and that phase 1's `[hidden]` rule and `:host` reset are still intact at the end of `STYLE`.
7. Run each command separately — `pnpm --filter extension build`, then `pnpm --filter extension test`, then `pnpm --filter extension test:e2e`; they cannot be chained as arguments, since only the first token is the script name. Then load unpacked and check the overlay against a real meeting page in both light and dark OS settings, **and over a deliberately white video frame** — a translucent panel over a bright background is the case that has no test and no reviewer.
8. Reconcile `docs/design-guidelines.md` against what actually shipped across phases 4-6 — the values, and any state that turned out to need a colour the document does not list.

## Success Criteria

- [x] No brand hex or rgba literal remains in `STYLE`
- [x] No `var(--` appears anywhere in the overlay CSS
- [x] `style.textContent = STYLE` is byte-identical as a mechanism; only the string differs
- [x] No `prefers-color-scheme` in the content script
- [x] `pnpm --filter extension build`, `test`, `test:e2e` each pass
- [x] Phase 1's `[hidden]` rule and `:host` reset survived the rewrite
- [x] The panel stays legible over a white video frame
- [x] Overlay screenshotted beside web `/translate` reads as the same product
- [x] `docs/design-guidelines.md` matches the shipped values

## Risk Assessment

- **Someone "improves" this later by switching to CSS variables** for theming convenience. Signal: `var(--` in the content script. Response: the reason lives as a comment beside the interpolation, not only in this plan — write it there.
- **Contrast over arbitrary video.** The panel is translucent; a bright meeting background can wash out `textMuted`. Signal: source text unreadable over a light video feed. Response: raise `overlay.bg` opacity rather than changing text colour — the panel is the thing that must stay legible, and text tokens are shared with web.
- **Bundle growth in a content script.** Tokens are plain values, so the cost is bytes, not a runtime. Signal: a measurable jump in the built content script. Response: check the `.output` size before and after; if it moved meaningfully, something other than tokens got imported.
