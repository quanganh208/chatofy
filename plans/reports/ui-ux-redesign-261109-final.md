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

## Not done, and why

| Item                                                           | Why                                                                                                      |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Usability test with real users (1.9a, 6.1a)                    | Needs 3 to 5 human testers; the kit is ready                                                             |
| Owner sign-off on before and after screenshots (4.8, 6.6)      | The owner decides taste                                                                                  |
| Production build and LCP / INP / CLS (6.3)                     | Not run: dev server figures would be misleading, and the build was out of scope for this pass            |
| hallmark and Emil skills (1.8)                                 | They write into `.claude/`; replaced by axe, keyboard, worst-case data and the rubric                    |
| Toast, command palette (5.2, 5.3)                              | Gate A assumption: inline confirmation already exists ("Copied", "Link copied", save states); no palette |
| `/conference` live call, offline and server-error states       | Needs two accounts and a way to force failures; not exercised                                            |
| Reduced-motion pass (5.4)                                      | Not run; the app already honours it in 34 files per the earlier code audit                               |
| `/preferences` has 37 controls under 44px for a mouse at 375px | Touch screens get 44px only on the topbar; the rows were not changed                                     |
| Mobile and extension apps                                      | Out of scope (web only)                                                                                  |

## Pre-existing problems found, not caused by this work

- Four `skin-guard.spec.ts` tests in `packages/ui` fail on `input.tsx`, `textarea.tsx`, `select.tsx`
  ("field body not found"). They fail identically with these changes stashed.
- `pnpm` is missing from PATH on this machine; the husky pre-commit needs it (a corepack shim was used).
- Several workspace packages had stale builds, and the `next dev -p ${WEB_PORT:-3001}` script
  breaks under cmd. Details are at the top of the baseline report.

## Assumptions the owner can overrule

Keep Direction A; inline confirmation over toasts; no command palette; `/translate` is the demo route;
no new dependency; app routes only. Each is recorded with its reversal cost in the direction report.
