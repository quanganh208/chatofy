# Extension redesign — cyan accent, opt-out overlay, compact popup

Status: done · Branch: `fix/overlay-style-isolation`

All five phases shipped. Verified: `turbo typecheck test` 19/19, extension
`build` + `lint`, web `build`, and the hand-run `e2e/run.mjs` 24/24 — including
both overlay-isolation checks, which needed the harness to push a capturing
render first now that the idle overlay is a pill rather than a panel.

## Outcome

The extension stops imposing itself. A user who installs it and never starts a
capture sees a small pill, or nothing at all if they turned it off. A user who
opens the popup sees the Start button without scrolling, and the colours mean
what they say. The purple accent is gone from every surface.

## Constraints

- `packages/ui/src/tokens.ts` stays the single place a brand value is authored;
  `apps/web/src/design/token-parity.spec.ts` stays the sync mechanism.
- The recording indicator stays non-dismissible **while capture runs**. Opt-out
  may hide the idle surface; it may never hide the fact that a meeting is being
  recorded.
- Overlay keeps its safety properties: closed shadow root, `:host { all: initial
!important }`, literal token values (never `var()`), `textContent` never
  `innerHTML`, no fixed host id.
- The content script must not import `@chatofy/types` — it ships on every
  meeting page.
- Cyan at fill strength cannot carry white text (3.00). `onAccent` flips to dark
  and `onLiveFill` is split out for the red bars that still need white.

## Non-goals

- Redesigning web or mobile layouts. They inherit the new token values and
  nothing more.
- New meeting platforms, capture/audio pipeline changes, i18n of extension
  strings.

## Acceptance criteria

1. No `#6E56CF` / `#7A5FD6` / `#9B87F5` / `#2A2250` anywhere in the repo.
2. Contrast, measured: dark text on `accent` ≥ 4.5; `accent` on `bg` ≥ 3;
   `accentText` on `bg` ≥ 4.5; white on `liveFill` ≥ 4.5.
3. Idle meeting page renders a pill, not a 340px panel. Capturing renders the
   panel with the indicator.
4. Turning the overlay off (globally or per site) leaves the idle page with
   nothing; starting a capture anyway still shows the indicator.
5. Popup at first run shows the consent step alone; afterwards Start is visible
   without scrolling at Chrome's 600px popup cap.
6. The unsupported-tab message no longer uses the live-red token.
7. `pnpm --filter extension test typecheck lint`, `pnpm --filter web test`,
   turbo build all green.

## Phases

### 1 — Tokens

`packages/ui/src/tokens.ts`: accent set → Radix dark cyan (9/10/11 + a subtle
step), `onAccent` → dark ink, new `onLiveFill` → white.
Propagate: `apps/web/app/globals.css`, `token-parity.spec.ts`,
`apps/web/src/components/ui/button.tsx` (live variant needs `on-live-fill`, not
`primary-foreground`), `apps/mobile/src/ui/theme.ts` inherits automatically,
`docs/design-guidelines.md` tables + rationale.

### 2 — Overlay visibility store

New `apps/extension/src/overlay-visibility.ts`: `{ enabled, disabledOrigins }`
in `chrome.storage.local` under its own key, no `@chatofy/types` import so the
content script can read it directly. Resolver `overlayHiddenFor(origin)`.

### 3 — Overlay: pill / panel

`entrypoints/content/index.ts`: collapsed-by-default pill; expands on click;
auto-expands when capture starts; collapsed-while-capturing degrades to the red
indicator pill rather than to nothing. Respects phase 2; hidden mode still
renders the indicator while capturing.

### 4 — Popup restructure

`entrypoints/popup/{index.html,main.ts,styles.ts}`: consent as its own step,
header with live status + host, three primary controls, `<details>` Advanced for
server + metrics + overlay switches, sticky footer Start. Unsupported message
demoted from live-red to a neutral/warning notice by kind.

### 5 — Verify

Unit tests for the new visibility resolver and for the contrast invariants;
typecheck, lint, build.

## Unresolved

- Extension UI stays English, matching web and mobile. Localising it is a
  product decision that would land across all three surfaces.
- `speaking` (#30A46C) and the new `accent` (#00A2C7) are closer in hue than
  the old violet was. Both always carry a label, so no use is colour-alone, but
  it is a narrower gap than before.
