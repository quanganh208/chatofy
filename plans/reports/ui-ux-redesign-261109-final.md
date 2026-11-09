# UI/UX redesign: final report

Date: 2026-11-09. Branch: `docs/ui-ux-redesign-plan`. Plan: `plans/261109-2100-ui-ux-redesign/plan.md`.
Baseline: `ui-ux-redesign-261109-baseline/report.md`. After-capture: `ui-ux-redesign-261109-after/`.
Direction and assumptions: `ui-ux-redesign-261109-direction.md`.

## What was done (one commit per job)

| Job                  | Commit     | Result                                                                                             |
| -------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| Plan and tracker     | `26f49eae` | 6 phases, testable criteria for friendly / accessible / modern / refined / beautiful / easy to use |
| Baseline capture     | `9d62763b` | 40 shots, axe, overflow and target measurements                                                    |
| Keyboard walk        | `2a311e41` | Focus rings, skip link, no traps                                                                   |
| Worst-case data      | `3eecefcf` | Defects D1 to D3 found                                                                             |
| Rubric               | `f63f42f5` | Ten routes scored                                                                                  |
| Phase 1 close, kit   | `caf3a916` | Usability test kit                                                                                 |
| Gate A and direction | `86210bea` | Decisions recorded as assumptions                                                                  |
| D1, D2 fix           | `652faa81` | History row and transcript wrap long strings                                                       |
| Touch targets        | `9b82a045` | 44px hit area on touch for the topbar controls                                                     |
| Text wrapping        | `26dc9c6f` | Headings balance, paragraphs avoid one-word last lines                                             |
| Translate first step | `26d0e235` | Empty pane names Start and the microphone prompt; dock tooltips                                    |
| Glossary             | `3f5f90ab` | Empty state explains itself; panes stack on phones                                                 |
| State inventory      | `d3681c7d` | Six rows with verified `file:line`                                                                 |

Every code change was written spec first (the spec failed, then the code made it pass).

## Before and after

| Measure                                      | Baseline                                                          | After                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Horizontal overflow, 10 routes x 4 viewports | `/history` and the edge-case transcript overflowed at every width | none (40 of 40 captures)                                                 |
| axe violations (WCAG 2.2 A and AA)           | 0 at 1440                                                         | 0 at 1440 and at 375, all 10 routes                                      |
| `<h1>` per page                              | 1                                                                 | 1                                                                        |
| Topbar controls on a touch screen at 375px   | 26, 28, 32px                                                      | 44 x 44 (measured with touch emulation); mouse widths unchanged          |
| impeccable advisories on `/`                 | 5 (orphan last lines)                                             | 2                                                                        |
| Glossary at 375px                            | detail pane about 86px wide, one word per line                    | list above detail, full width                                            |
| Translate empty pane                         | "What you say appears here."                                      | names the Start button and the microphone prompt, then the same sentence |
| Web tests                                    | not run                                                           | 128 files, 1544 tests pass                                               |
| Typecheck (web, ui), eslint on changed files | not run                                                           | clean                                                                    |

Screenshots: `ui-ux-redesign-261109-after/shots/` (all routes, four viewports, plus the touch topbar).

## Correction to the baseline rubric

The baseline scored `/glossary` as responsive 3 because it measured overflow only. A screenshot
at 375px showed a squeezed pane, so the real score was 1; it is fixed in this branch. The same
lesson applies to any future review: overflow numbers do not catch a layout that is cramped but fits.

## Provisional rubric after the changes

Changes from the baseline scores only; others stand. Beauty remains the auditor's judgement.

| Route                       | Change                                              |
| --------------------------- | --------------------------------------------------- |
| /translate/one-way, two-way | FR 1 to 2 (first step stated); CH 2, BE 2 unchanged |
| /glossary                   | RE 1 to 3, FR 1 to 2                                |
| /history, /history/[id]     | RE 1 to 3                                           |

Against the plan target (>= 2 everywhere, 3 on the demo route) the demo route `/translate` is
still at 2 for beauty and first impression: it is clear and calm but not yet memorable. Closing
that gap needs a design decision (a signature detail on the translate screen) rather than a fix,
so it is left for the owner.

## Round 2: conference, touch targets, failure states, visual polish

Scope added by the owner: finish conference, preferences controls and failure states, and improve
the visual design and layout of the web. Evidence: `ui-ux-redesign-261109-after/conference/`,
`ui-ux-redesign-261109-after/failures/`.

### Conference, run live with two accounts (fake camera and microphone, resized in place)

| Finding                                                                                                                                                                                                              | Fix                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 25 uses of two retired class names (`text-textMuted`, `bg-surfaceRaised`) in the conference screens. Tailwind generated nothing, so muted text rendered at full weight and tiles had no ground. Nothing reported it. | Renamed to `text-muted-foreground` and `bg-muted`; `legacy-token-classes.spec.ts` now forbids the old names across `apps/web` |
| A tile with no picture (audio only) was an empty rectangle with a name chip                                                                                                                                          | Dawn-ringed initials avatar, shared with the lobby (`utils/initials.ts`)                                                      |
| Lobby "Join now" ended at y=832 on a 812px phone                                                                                                                                                                     | Tighter spacing below `lg`; now ends at y=794                                                                                 |
| Two people side by side were two 540x700 strips, cropping a 16:9 webcam                                                                                                                                              | From a 42rem stage tiles keep 16:9 and the rows centre                                                                        |

No horizontal overflow at 1440, 768, 375, 320 and back to 1440 while resizing the live call. The ended page was reviewed and needed no change.

### Touch targets (measured with touch emulation at 375px)

`/preferences` went from 30 controls under 44px to 2 (the slider thumbs; the track is the tap target). Every other route reached 0.
Done in the shared components under `pointer-coarse:` (Button, Input, Select, Toggle, segmented control) and a pseudo-element hit area for Switch, so desktop sizing and the drawn switch are unchanged. Guarded by `touch-targets.spec.ts`.

### Failure states (API down, API 500, network dropped)

| State                                                                                    | Result                                                                                                                                             |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| API unreachable or 500 on translate, history, glossary, preferences, account, conference | Each screen stays usable and says what failed in plain words                                                                                       |
| History list                                                                             | Already had an alert and Try again                                                                                                                 |
| Glossary list                                                                            | Printed a red sentence only. Now announced (`role="alert"`) with a Try again button                                                                |
| Network dropped (offline)                                                                | The browser's own "no internet" page. The app has no offline page or service worker; building one is a feature, not a polish fix, and is left open |

### Visual polish

- Glossary empty list now matches History's empty list (icon, bold title, one sentence) in both locales.
- Conference visuals above (muted hierarchy restored, avatar tiles, landscape tiles).
- Signature detail on the translate screen: the landing lotus opens above the first-step sentence in the empty source pane (commit 1219f5a0), in light and dark, hidden below 640px. The owner can still ask for a different detail; this one is a taste call.

### Checks after round 2

Web: 132 files, 1554 tests pass. `@chatofy/ui`: 188 of 189 pass (the one failure, `skin-guard` on `textarea.tsx`, is a CRLF artefact of this Windows checkout: three sibling failures disappeared when their files were rewritten with LF). i18n: 28 pass. Typecheck clean. ESLint reports only CRLF line-ending noise on files not touched here.
After-capture (10 routes x 4 viewports, signed in): no redirect, no overflow, axe 0 violations at 1440 and 375.

## Round 3: the review repos, actually run

Run from isolated clones (nothing written to `~/.claude` or the repo's `.claude/`; the skills are instruction
files, so their rules were applied directly). Evidence: `ui-ux-redesign-261109-after/audit-tools/`.

| Tool                                                                                                     | What was run                                                                                                         | Result                                                                                  |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| nutlope/hallmark                                                                                         | `sloplint` static over `apps/web/src` and `apps/web/app` (211 files), then `--render` on the landing page (8 widths) | 93 static findings, 1 render FAIL; triaged below                                        |
| emilkowalski/skills                                                                                      | `review-animations` rules applied to the code; `break-ui` method applied with plausible data through the API         | 3 motion fixes, 1 layout fix; details below                                             |
| ui-ux-pro-max                                                                                            | Its pre-delivery checklist, item by item                                                                             | Two items had never been run (dark-mode contrast, reduced motion); both now pass        |
| pbakaus/impeccable                                                                                       | Earlier `detect` runs (source and landing)                                                                           | 0 anti-patterns, advisories 5 to 2                                                      |
| google design.md, awesome-design-md, open-design, taste-skill, react-bits, gsap, scroll-world, canvas-ui | Cloned or read only                                                                                                  | Not run: they generate or restyle rather than audit, and the plan rules out re-skinning |

### hallmark triage (93 static findings)

| Gate                               | Count | Verdict                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 48 colour literal outside tokens   | 72    | False positive: every one is in `globals.css`, the token block itself                                                                                                                                                                                                                         |
| 67 uppercase at 11px               | 8     | **Real, 3 fixed.** Our own guideline says 11px uppercase is for section headings only (Vietnamese capitals with diacritics are hard to read). Speaker names in History, the Source / Translation label and the conference Meeting code had drifted. The other 5 are section headings and stay |
| 10a transition on layout property  | 3     | 1 fixed (lobby level bar). The translate mic meter stays: its bars sit in a fixed 22px box and its spec is built around the height being data. The slider thumb is Radix positioning                                                                                                          |
| 19 dash in copy                    | 1     | False positive: a code comment                                                                                                                                                                                                                                                                |
| 20, 34 stamp, `overflow-x: clip`   | 2     | Declined: a house stamp is hallmark's convention, and `overflow-x: clip` would hide the horizontal-overflow bugs the review is measuring                                                                                                                                                      |
| 38i emphasis in h1                 | 1     | Dev-only social-card page                                                                                                                                                                                                                                                                     |
| 26b no :active styling             | 1     | False positive: `Button` has `active:translate-y-px`                                                                                                                                                                                                                                          |
| 28b video without poster           | 2     | Declined: live camera streams have no poster                                                                                                                                                                                                                                                  |
| F1 straight quote                  | 3     | Code comments                                                                                                                                                                                                                                                                                 |
| Render 58: 218 words on one screen | 1     | The privacy section ("How your recordings are handled"). Left as is: it has to be complete and its wording is locked by the copy spec                                                                                                                                                         |

### Emil rules

| Finding                                                                     | Fix                                          |
| --------------------------------------------------------------------------- | -------------------------------------------- |
| Sheet (mobile sidebar, landing menu) opened in 500ms on ease-in-out         | 300ms open, 200ms close, ease-out            |
| Accordion trigger used `transition-all`                                     | Named properties                             |
| Lobby level bar animated width every frame                                  | `transform: scaleX`                          |
| (break-ui) A roster of many long names made history rows several lines tall | Clamped to two lines, full list as a tooltip |

break-ui used plausible, schema-backed data (name at the 80-character limit in Vietnamese, a long company email, 6 long Vietnamese speaker names, 30 conversations, a 300-turn meeting, a two-letter name). Held up: no horizontal overflow on account, history, preferences or the 300-turn detail at 1440 and 375; long names ellipsise in the sidebar and wrap on the account page. The 300-turn transcript loads in 1.8 to 2.9s on the dev server (2.6k DOM nodes, a 61k to 99k px page): fine for now; a longer meeting would want windowing.

### ui-ux-pro-max checklist, the two unrun items

Dark mode: axe (including colour contrast) reports 0 violations on all signed-in routes at 1440. The public auth pages in dark were not scanned (signed-in sessions redirect away from them).
Reduced motion: with `prefers-reduced-motion: reduce`, no animation is running on any route.

### Checks after round 3

Web, ui and i18n tests pass except the one CRLF-artefact `skin-guard` failure in `packages/ui` noted above. New specs: `uppercase-labels`, `motion-craft`, `mic-level-meter`, history roster clamp.

## Round 4: resizable panels, filling the window, a stronger page identity

Asked for by the owner: drag-to-resize panels, less empty space, a more comprehensive and more striking UI.
Evidence: `ui-ux-redesign-261109-redesign/before` and `after`, `ui-ux-redesign-261109-after/resize`.
This round overrides the earlier "keep Direction A and polish" assumption: the palette and tokens stay,
but layout and identity changed substantially.

| Change               | Detail                                                                                                                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resizable sidebar    | New `ResizeHandle` (WAI-ARIA splitter): drag, arrow keys (16px, Shift 64px), Home and End, double click resets. 200 to 360px, remembered per browser. Absent on the icon rail and on phones. Verified in a real browser: drag 256 to 346px, keyboard steps, limits, survives a reload, reset        |
| Resizable chat panel | Same handle on the call's chat column: 240px up to half the window (480px cap), remembered, hidden where the panel covers the video                                                                                                                                                                 |
| Page header          | History, Glossary, Preferences and Account open with their one h1 in the display face (44px from `lg`), a dawn bar and a line saying what the page is for. The topbar keeps the name as plain text, so there is still exactly one h1                                                                |
| Space                | The 672px content column became `max-w-6xl` for headed pages. History is a two-column card grid, Account has Security and Session cards side by side, Preferences flows into two columns, the glossary panel aligns with the header, and the conference landing is a two-column hero with the lotus |

At 1440px these pages used about 55% of the workspace; each now spans it. Phone layouts keep a single column.
After this round: 40 of 40 signed-in and public captures with exactly one h1, no horizontal overflow, axe 0 violations at 1440 and 375, dark mode axe 0, no running animation under reduced motion. Web suite 136 files, 1588 tests pass.

The surface budget changed in one place: `/account` now draws 2 elevated surfaces (Security and Session) instead of 1. That is within the ceiling of 2 and the spec table was updated to say so.

## Not done, and why

| Item                                                      | Why                                                                                                      |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Usability test with real users (1.9a, 6.1a)               | Needs 3 to 5 human testers; the kit is ready                                                             |
| Owner sign-off on before and after screenshots (4.8, 6.6) | The owner decides taste                                                                                  |
| Production build and LCP / INP / CLS (6.3)                | Not run: dev server figures would be misleading, and the build was out of scope for this pass            |
| hallmark and Emil skills (1.8)                            | They write into `.claude/`; replaced by axe, keyboard, worst-case data and the rubric                    |
| Toast, command palette (5.2, 5.3)                         | Gate A assumption: inline confirmation already exists ("Copied", "Link copied", save states); no palette |
| `/conference` live call, offline and server-error states  | Needs two accounts and a way to force failures; not exercised                                            |
| Reduced-motion pass (5.4)                                 | Not run; the app already honours it in 34 files per the earlier code audit                               |
| Mobile and extension apps                                 | Out of scope (web only)                                                                                  |

## Pre-existing problems found, not caused by this work

- Four `skin-guard.spec.ts` tests in `packages/ui` fail on `input.tsx`, `textarea.tsx`, `select.tsx`
  ("field body not found"). They fail identically with these changes stashed.
- `pnpm` is missing from PATH on this machine; the husky pre-commit needs it (a corepack shim was used).
- Several workspace packages had stale builds, and the `next dev -p ${WEB_PORT:-3001}` script
  breaks under cmd. Details are at the top of the baseline report.

## Assumptions the owner can overrule

Keep Direction A; inline confirmation over toasts; no command palette; `/translate` is the demo route;
no new dependency; app routes only. Each is recorded with its reversal cost in the direction report.
