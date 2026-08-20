# Phase 7 — Popup rewrite

Branch `feat/production-ui-ux`. 419 lines of imperative DOM → React on the shared
components. Vanilla files deleted only after e2e was green on the rewrite.

## Shape

| was                                 | is                                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.ts` (419) + `styles.ts` (538) | `main.tsx`, `popup.tsx`, `settings-pane.tsx`, `use-popup.ts`, `popup-status.ts`, `consent-gate.ts`, `style.css` (~700 total, mostly comments) |
| `<select id="direction">`           | `DirectionToggle` — Source / Translation, swap button                                                                                         |
| `<select id="voice">`               | Radix `Select` — its first real consumer                                                                                                      |
| `<select id="theme">`               | shared `ThemeToggle`                                                                                                                          |
| hand-drawn checkboxes               | Radix `Checkbox` + `Label`                                                                                                                    |
| `.notice` divs                      | `Alert` (`default` / `warning` by `support.kind`)                                                                                             |
| `.state` pill                       | `StatusIndicator`                                                                                                                             |

`style.css` is 60 lines and only holds what no utility can carry: the `body`
frame, the React root's `display` so it disappears into the column, the scroll
mask, and `scrollbar-width`.

## The consent notice stays out of React

`index.html` still owns it, and `consent-gate.ts` drives it with plain DOM,
attaching the button handler at module load before anything renders. It is the one
legally meaningful thing on this surface, and `#toggle` is its **sibling** — a
later error boundary could render the footer while the notice's branch failed,
which is a working Start button with no declaration.

Its snapshot is `undefined` until storage answers, which is deliberately not
`false`: rendering the settings during that window shows the popup to someone who
has not seen the notice.

**Start is now disabled while the notice is up**, not merely hidden behind it.
Hidden-but-enabled is one CSS change away from being a live control in front of
someone who has not been told what it does.

## Guards: replaced by failure class, not by file

Deleted `popup-style.spec.ts` and `popup-structure.spec.ts`; wrote
`src/popup-invariants.spec.ts` (7 tests).

| old assertion                                        | now                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| CSS template not truncated                           | **gone** — no template literal left to truncate                                                  |
| every `--var` read is declared                       | moved to `token-parity.spec.ts` earlier                                                          |
| `el('id')` ↔ ids in markup                           | **gone** — JSX has no lookups; that failure cannot occur                                         |
| no experiment controls                               | kept, against all popup sources                                                                  |
| every `<label>` names a control                      | kept, and now also matches `<Label>`                                                             |
| no typed arrow                                       | kept                                                                                             |
| footer outside `main`                                | **gone** — replaced by the e2e check that Start is reachable                                     |
| _(new)_ no `innerHTML` / `dangerouslySetInnerHTML`   | React makes the escape hatch one word, and this page renders strings from the tab and the worker |
| _(new)_ `#consent-ok`, `#toggle`, `main` still exist | the three names the harness steers by                                                            |
| _(new)_ notice is in static markup                   | the decision above, enforced                                                                     |

Mutation-verified: a planted `dangerouslySetInnerHTML` and a `<Label>` stripped of
`htmlFor` each turn exactly one test red. A floor test guards the directory read,
since every assertion is satisfied by an empty file list.

## e2e: 56 → 65

New per-state check: while the notice is up, it must have content **and** Start
must not be pressable; once acknowledged, it must be gone. Both directions
asserted so a page that failed to render cannot pass as "not consenting".

Mutation-verified: dropping `consenting ||` from the button's `disabled` gives
`start ENABLED` and one failure.

## New: `src/popup-render.spec.tsx`, 6 tests, happy-dom

Covers wiring a browser is not needed for: the tree mounts, the notice gates
Start, a wrong tab disables Start with the right sentence, a running capture stays
stoppable from a wrong tab, a direction change goes to the **worker** and not to
storage, and `reportMetrics` survives a save while `apiBaseUrl` is never written.

## Two things found on the way

**`packages/types/tsconfig.json` used the package-export `extends` form.** The
repo already had this written down twice, including the line "`packages/types`
gets away with the export form only because it has no test runner". That stopped
being true — not because types gained a spec, but because the popup's spec
transforms `packages/types/dist`, and what matters is the nearest tsconfig to the
file being transformed, not who owns the test. Fixed; both stale comments
corrected.

**`@vitejs/plugin-react` was not needed here** and I added it anyway, by analogy
with `packages/ui`. That package needs it because Next's tsconfig sets
`jsx: "preserve"`; the extension's sets `react-jsx`, so the default transform
already handles JSX. Removed after checking the spec stays green without it.

## Behaviour preserved

Read every comment before deleting the line under it. Carried across: two-tier
capture gate (`support.ok && runsOn`), Stop always available, settings never
hidden for the wrong tab, mic notice tied to `outbound` and re-asked on open,
three site rows built from `SUPPORTED_MEETINGS`, site enablement on its own write
path so a checkbox cannot reopen a running capture, `reportMetrics` carried and
`apiBaseUrl` dropped on save, `mode` written explicitly, optimistic Start/Stop,
measured scroll fade, `chatofy.theme` outside `CaptureSettings`.

The scroll fade is now `data-scrolls` set from a layout effect that runs after
every render, rather than a class toggled at four call sites — the render that
removes the reason is the one that clears it.

## Gates

`turbo lint typecheck test build` 28/28 · `verify:build` 10/10 · extension unit
**188** (was 182 across 15 files; now 16 files) · web 161 · packages/ui 20 · e2e
**65/0** · knip at baseline.

Popup bundle: **110.3 kB gzip** (322 kB raw JS, 34 kB CSS). Against Phase 6's
87.1 kB, which still contained the 12.4 kB vanilla popup and rendered one Button;
this renders the whole surface — Select, Checkbox, Label, Alert, ThemeToggle,
DirectionToggle, StatusIndicator and their icons.

## Unresolved

- `SITE_ENABLEMENT_KEY` and `ComposedGraph` remain knip-unused; both predate this
  work.
- Voice is still a dropdown while Direction is a pair of named sides. Deliberate
  and recorded in the plan, but it means the two adjacent controls are different
  kinds of thing — a Phase 8 note, not a defect.
- The popup no longer has any hand-written colour, so `styles.ts`'s token names
  (`--accent`, `--text`, `--surface-raised`) are gone from this surface. The
  overlay still uses them from `@chatofy/ui`; nothing to do, but the two surfaces
  now name the same colours differently.
