---
phase: 8
title: 'Extension popup restyle'
status: pending
priority: P3
effort: '4h'
dependencies: [6]
---

## Overview

Conditional phase. The popup is 145 lines of HTML with browser-default form
controls. After phase 6 gives it the shared state colours, decide by looking at
it whether it still needs work — and if it does, restyle it as plain CSS, not by
adding React.

## Requirements

- Functional: popup controls match the product's visual language; every existing behaviour in `entrypoints/popup/main.ts` is untouched.
- Non-functional: no React, no Tailwind, no new build machinery in the extension; `pnpm --filter extension build` and `test` pass.

## Architecture

The popup is the one extension surface where React and Tailwind would actually
be _safe_ — it is an ordinary extension page, no shadow root, no third-party
DOM, no closed-root invariant to preserve. That is the argument for doing it,
and it is not enough on its own.

Against: `apps/extension/wxt.config.ts` records a deliberate decision to run
this extension with no UI framework, and the reason given is partly the overlay
and partly MV3's CSP forbidding `eval`. Adding React for one 145-line page
reintroduces a framework, a Tailwind content-scan config spanning
`packages/ui`, and a React-version reconciliation against web's 19.2.5 — to
style eight form controls. The honest version of this phase is: **hand-written
CSS using the same tokens, same as the overlay.**

If a future surface makes the popup genuinely complex — a settings panel with
several views — revisit. That is a different phase with a different
justification, not this one.

The popup's styles live in a `<style>` block inside `index.html`, which cannot
import TypeScript. Two options, decide when starting: move the block into
`main.ts` and inject it (mirrors the overlay, keeps one token path), or keep it
in the HTML and accept that its handful of values are copied with the parity
test extended to cover them. Prefer the first — the overlay already proves the
pattern.

## Related Code Files

- Modify: `apps/extension/entrypoints/popup/index.html` — markup and `<style>` block
- Modify: `apps/extension/entrypoints/popup/main.ts` — style injection only, if that option is chosen
- Verify: `apps/extension/src/settings.ts` — the popup's state source, unchanged

## Implementation Steps

1. **Decide first.** Open the popup after phase 6 has landed. If the shared state colours already made it acceptable, close this phase as not needed and record why. Do not restyle on principle.
2. If proceeding: move the `<style>` block into `main.ts` as a token-interpolated string, injected on load — the same shape as the overlay's `STYLE`.
3. Style the form controls: `select` and `input` need explicit backgrounds, borders and radius from the token scale, because browser defaults ignore `color-scheme` inconsistently across platforms.
4. Style the primary button with the accent, the notice and mic boxes with `warning`, the unsupported box with `live` — matching what phase 6 did to the same three boxes.
5. Give every control a visible `:focus-visible` ring.
6. Leave `main.ts`'s behaviour completely alone: the first-run notice acknowledgement, the microphone grant flow, the unsupported-tab message, and the settings persistence are all correct and none of them are presentation.
7. Run `pnpm --filter extension build`, `pnpm --filter extension test`, `pnpm --filter extension test:e2e` as separate commands, then click through the popup on a supported tab, an unsupported tab, and a first run with storage cleared.

## Success Criteria

- [x] Either the phase is closed with a recorded reason, or the popup is restyled
- [x] If restyled: no React, no Tailwind, no new dependency in `apps/extension`
- [x] No behavioural diff in `entrypoints/popup/main.ts` beyond style injection
- [x] First-run notice, microphone grant, and unsupported-tab paths all verified by hand
- [x] `pnpm --filter extension build`, `test`, `test:e2e` each pass

## What actually happened

The phase was **not** closed. Looking at the popup after phase 6, the three
coloured boxes matched the overlay and everything around them was still browser
default — and this is the surface a user gets when they click the toolbar icon,
so "the extension does not look finished" was still true of it.

Done as planned: hand-written CSS from the shared tokens, no React, no Tailwind,
no new dependency. The stylesheet moved into `entrypoints/popup/styles.ts` and is
injected by `main.ts`, mirroring the overlay. `main.ts` grew by nine lines — the
import and the injection — and nothing else; the first-run notice, the microphone
grant flow, the unsupported-tab message and settings persistence are untouched.

One deliberate duplication: `index.html` keeps a three-line `<style>` with the
background and text colour. `main.ts` is a deferred module, so without it the
popup paints white before the real stylesheet lands. Every other value on the
page comes from the token module, and the comment there says why these two do
not.

## Risk Assessment

- **Restyling drags behaviour changes with it.** The popup's flows are subtle — the notice is dismissible only by its button, settings stay visible on unsupported tabs on purpose, the mic box appears only when outbound is on. Signal: any diff in `main.ts` outside style injection. Response: those comments in the HTML explain why each rule exists; read them before moving markup.
- **"While we're here, let's add React."** Signal: a `.tsx` file in `entrypoints/popup/`. Response: that is a separate decision needing its own justification, and `wxt.config.ts` currently documents the opposite.
- **This phase never gets done and that is fine.** It is P3 and conditional by design.
