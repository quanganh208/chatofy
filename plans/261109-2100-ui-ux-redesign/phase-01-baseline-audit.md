# Phase 1: Baseline audit (read-only)

## Steps

1. `docker compose up -d --wait postgres redis`, `pnpm dev`; fixed web port, reuse a
   running instance, stop what you started.
2. Register a local test account via `POST /auth/register`; sign in through `/login`;
   capture in ONE browser context (refresh tokens rotate).
3. Screenshot `/`, `/login`, `/register`, `/translate/one-way`, `/translate/two-way`,
   `/conference`, `/history`, `/history/[id]` (seed long turns), `/preferences`,
   `/account`, `/glossary` at 1440x900, 768x1024, 375x812, plus 320px reflow.
   Reuse `plans/reports/enhance-ux-ax-261027-1636-conference/capture-conference.mjs`.
4. Per route: axe scan, keyboard-only walk, one `<h1>`, console errors, touch-target
   and focus check, worst-case data (long names, long translations, empty, offline).
5. Score with the 0-3 rubric in `docs/ux-ax-review-checklist.md`.
6. With owner OK: impeccable URL scan, hallmark `audit` + `sloplint --render`, Emil's
   `review-animations` and `break-ui`. Triage every hit against the guidelines.
7. Record the three core user journeys and where each one stalls.

## Output

`plans/reports/ui-ux-redesign-261109-baseline.md`: screenshot index, ranked defect
table (route, viewport, severity, evidence, defect vs deliberate choice), journey
friction list. No source edits. Delete the test account and its data afterwards.
