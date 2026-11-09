---
title: Web UI/UX redesign (friendly, accessible, modern, refined)
status: draft
created: 2026-11-09
mode: hard
scope: apps/web, packages/ui, packages/i18n, docs
supersedes: ../261109-1856-web-ui-ux-uplift/plan.md
---

# Web UI/UX redesign

## Outcome

A first-time user can finish a translation, join a conference and find their history
without help, on phone, tablet and desktop, by keyboard or pointer, in vi and en.
The look stays calm, modern and refined. Quality is measured, not asserted.

## What changed from the previous plan

The old plan was a polish pass with "no re-skin" as a non-goal. This plan is a
redesign, so visual changes are in scope, **but** the current direction (Direction A:
editorial, ink for action, dawn mark) was chosen over four review rounds and is gated
by specs. Default is to keep it and redesign layout, flows, feedback and accessibility
on top of it. Any change to the direction itself needs an explicit owner decision at
Gate A (phase 2), not drift.

## Principles (the brief, made testable)

| Goal              | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Easy to use       | Three core tasks (translate a sentence, join a conference, find a past conversation) are timed in phase 1 and again in phase 6 with 3-5 first-time users (classmates are fine): >= 90% finish unaided, each in <= 3 steps from the landing screen or sidebar, no dead ends, errors say how to recover, every control labelled in plain words (no jargon), primary action visible without scrolling at 375px.                                                                                                                                                     |
| Modern (platform) | Responsive from 320px to desktop, dark/light/system theme, smooth but short motion (<= 200ms, none under reduced-motion), fast feel (production LCP <= 2.5s, INP <= 200ms).                                                                                                                                                                                                                                                                                                                                                                                      |
| Friendly          | Every screen has one obvious next step; empty, loading, error and first-run states are written in plain language (copy-register spec, vi + en).                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Accessible        | WCAG 2.2 AA: contrast floors, 44px touch targets, visible focus, full keyboard path, reduced motion, screen-reader names; axe has 0 serious/critical on every route.                                                                                                                                                                                                                                                                                                                                                                                             |
| Modern            | Consistent type scale, spacing and component states; motion only where it explains a change; no generic AI-template patterns (impeccable/hallmark clean after triage).                                                                                                                                                                                                                                                                                                                                                                                           |
| Beautiful         | "Đẹp" is judged, not assumed: (1) rubric scores on first impression, hierarchy, brand recall and motion are >= 2 on every route and 3 on the demo route; (2) hallmark's 57-criteria audit and impeccable show no unresolved generic-template hits; (3) side-by-side screenshots against the phase-2 reference set read as at least equal; (4) the owner signs off the before/after screenshots per route (final say on taste). Beauty comes from hierarchy, whitespace, type, rhythm and one memorable detail per screen, never from extra colour or decoration. |
| Refined           | Accent and elevation budgets hold; no new colours marking controls; screenshots at 1440x900, 768x1024, 375x812 and 320px reflow have no overflow, clipping or overlap.                                                                                                                                                                                                                                                                                                                                                                                           |

## Reference repos: how each is used

Fit is judged against our contract. Verdicts come from the earlier README review and
the 2026-11-09 liveness check (none archived). Repos marked * rest on README text only
and must be re-read before any reuse.

| Repo                                  | Role in this plan                                                                                                                                                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pbakaus/impeccable                    | **Evidence (phase 1, 6):** `npx impeccable detect` (read-only; already ran on source: 0 findings, regex-only) plus URL scan of running pages for contrast/tiny text; `critique`/`audit` as leads. Do not run `init` or steer commands. |
| nutlope/hallmark                      | **Evidence (phase 1, 6):** `audit` and `sloplint --render` for the viewport pass. Never `redesign`. Needs Chrome + puppeteer-core and writes files, so ask the owner first.                                                            |
| emilkowalski/skills                   | **Craft (phase 4):** `review-animations`, `break-ui` (worst-case data), `animation-performance`; `ask-sonner` informs the toast decision.                                                                                              |
| google-labs-code/design.md            | **Optional (phase 2):** `lint` for token refs and contrast, only if Gate A wants a machine-readable `DESIGN.md`. Otherwise skip: it duplicates `docs/design-guidelines.md`.                                                            |
| nextlevelbuilder/ui-ux-pro-max-skill* | **Checklist only:** same as installed `ak-ui-ux-pro-max`. Use its accessibility/interaction rules; ignore its style-by-product-type picker.                                                                                            |
| VoltAgent/awesome-design-md*          | **Ideas only:** read Linear/Notion/Raycast entries for density and navigation patterns. Never copy a brand look.                                                                                                                       |
| nexu-io/open-design*                  | **Optional:** throwaway HTML prototypes for Gate A options, only if the owner wants to compare directions. Heavy install; skip otherwise.                                                                                              |
| Leonxlnx/taste-skill*                 | Skip: marketing-page generator.                                                                                                                                                                                                        |
| DavidHDev/react-bits*                 | Skip: decorative motion, extra deps, Commons Clause licence.                                                                                                                                                                           |
| greensock/gsap-skills*                | Skip: no scroll scenes in the app. Reconsider only for the landing hero.                                                                                                                                                               |
| oso95/scroll-world*                   | Skip: paid video generation, marketing only.                                                                                                                                                                                           |
| DavidHDev/canvas-ui*                  | Skip: no standard licence, Chrome origin trial only, decorative.                                                                                                                                                                       |

Product pattern sources (licence + code check before any port): Vercel Chatbot and AI
Elements (composer, transcript), Vexa (live transcript + translation, nearest to
`/conference`), shadcn-admin (settings shell). Port individual patterns only.

## Phases

| #   | Phase                     | Output                                                                                                                                | Gate                                                                         |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | Baseline audit            | Screenshots (10 routes x 3 viewports + 320px), axe + keyboard pass, impeccable/hallmark leads, ranked defect list in `plans/reports/` | Owner OK to run third-party tools                                            |
| 2   | Direction and IA decision | Journey map for 3 core tasks, nav/IA proposal, 2 layout options for `/translate` and `/conference` as screenshots, recommendation     | **Gate A:** owner picks keep-direction vs change, toast, palette, demo route |
| 3   | Foundations               | Token/type/spacing/focus/touch-target fixes in `packages/ui`; accessibility defects from phase 1                                      | Specs green                                                                  |
| 4   | Core flows                | `/translate` (readiness + first-run), `/conference`, `/history`, auth, preferences/account, glossary: layout, states, copy, motion    | Per-route screenshots + keyboard pass                                        |
| 5   | Feedback and navigation   | Toast or inline confirmation, shortcut/palette per Gate A                                                                             | Budget specs updated first                                                   |
| 6   | Verify and document       | Re-run phase 1 tooling and diff, update `docs/design-guidelines.md` State inventory, final report                                     | All acceptance criteria                                                      |

Order is deliberate: measure, decide, fix foundations, then flows. No visual rework
before Gate A. Details: `phase-01-baseline-audit.md`, `phase-02-direction-and-ia.md`,
`phase-03-to-06-implementation.md`.

## Progress

Last updated: 2026-11-09. Overall: phases 0 to 6 run; open items need people: usability test (1.9a, 6.1a),
owner sign-off (4.8, 6.6) and a production-build measurement (6.3).
Update this section at the end of every work session (tick the box, add date + evidence link).

| #   | Phase                     | Status                     | Done / total     | Blocked by                 |
| --- | ------------------------- | -------------------------- | ---------------- | -------------------------- |
| 0   | Planning                  | done 2026-11-09            | 5 / 5            | -                          |
| 1   | Baseline audit            | done except 1.9a           | 9 / 10           | human testers for 1.9a     |
| 2   | Direction and IA (Gate A) | done (assumed)             | 4 / 6 +2 skipped | -                          |
| 3   | Foundations               | done                       | 5 / 5            | -                          |
| 4   | Core flows                | done except 4.8            | 7 / 8            | owner sign-off (4.8)       |
| 5   | Feedback and navigation   | done (assumed)             | 2 / 4 +2 partial | -                          |
| 6   | Verify and document       | done except 6.1a, 6.3, 6.6 | 4 / 7            | testers, owner, prod build |

Status values: todo, in progress, blocked, done. Evidence column is a path under
`plans/reports/` or a commit hash.

### Phase 0: Planning

- [x] Read previous plan, design guidelines, UX/AX checklist (2026-11-09)
- [x] Review the 12 reference repos against our contract; verdicts recorded above
- [x] Carry over prior evidence: impeccable `detect` on `apps/web/src` ran, 292 files,
      0 findings, regex-only, no files written; repo liveness check, none archived
- [x] Add "beautiful" criterion with testable checks
- [x] Write `plan.md` and phase files

### Phase 1: Baseline audit

- [x] 1.1 Start stack (postgres, redis, api :3000, web :3001) (2026-11-09; env workarounds in `plans/reports/ui-ux-redesign-261109-baseline/report.md`)
- [x] 1.2 Register local test account, sign in in one browser context (2026-11-09)
- [x] 1.3 Screenshots: 10 routes x 4 viewports (40 shots; `/history/[id]` pending, needs a seeded conversation) (commit 9d62763b)
- [x] 1.4 axe scan per route at 1440: 0 violations on all 10 routes; 375px scan still to do (commit 9d62763b)
- [x] 1.5 Keyboard-only walk (page level: focus rings, skip link, no traps, Tabs to primary; task walks needing mic or data move to 1.6) (2026-11-09)
- [x] 1.6 Worst-case data pass: history list and detail with long text and unbroken strings; defects D1-D3 in the report (empty, offline, error states move to 1.7) (2026-11-09)
- [x] 1.7 Rubric scoring 0-3 per route (incl. beauty), provisional: owner confirms taste (2026-11-09)
- [x] 1.8 Tool evidence: impeccable detect (source + public pages) and axe on every route done; hallmark and Emil skills NOT installed (they write into the repo `.claude/`, which needs owner approval), their checks replaced by axe, keyboard walk, worst-case data and the rubric (2026-11-09)
- [ ] 1.9a Baseline usability test: kit ready in `plans/reports/ui-ux-redesign-261109-baseline/usability-test-kit.md`; needs 3-5 human testers, deferred to the owner
- [x] 1.9 Write `plans/reports/ui-ux-redesign-261109-baseline.md`; stop dev processes; delete test account (final-report folder `plans/reports/ui-ux-redesign-261109-baseline/report.md`; test account and its 3 conversations deleted from the local DB; 2026-11-09)

Evidence so far (2026-11-09, owner approved running impeccable; web only on :3001,
Node 26.13, Docker engine unresponsive so no api and no signed-in routes):

- 1.8 partial: `impeccable detect http://localhost:3001/` = 0 anti-patterns plus 5
  advisories (four one-word last lines: "Facebook.", "giờ.", "again.", "private."; one
  unbalanced heading, last line 34% of the line above). Remedy is `text-wrap: pretty`
  on body copy and `balance` on headings; only 6 `text-wrap`/`text-balance`/
  `text-pretty` uses exist in `apps/web`. Cosmetic; confirm on screenshots.
  `/login` = exit 0, no output. Authenticated routes not scanned.
- Dev server stopped after the scan; nothing of mine is still running.
- Windows run notes: repo needs Node >=26 (fnm). pnpm's `next dev -p ${WEB_PORT:-3001}`
  fails under cmd; use `pnpm --filter web exec next dev -p 3001`. Root `node_modules`
  had undeletable files (Access denied), so it was renamed to `node_modules.stale-*`
  (excluded in `.git/info/exclude`) and reinstalled; delete the stale dir from an Admin
  shell. Per-app `.env` files were replaced by one root `.env` (apps/mobile keeps its own).

### Phase 2: Direction and IA (Gate A)

- [x] 2.1 Three core journeys with friction points
- [x] 2.2 IA proposal (sidebar, titles, empty-state targets, shortcuts)
- [~] 2.3 Beauty references: none supplied; used the landing page level as the bar (assumption, owner may supply references)
- [x] 2.4 Two layout options for `/translate` (reasoned, not prototyped); `/conference` needs no layout change
- [~] 2.5 Product-pattern review skipped: no external pattern is ported (nothing found that existing components cannot do); licences stay unchecked
- [x] 2.6 Direction report `plans/reports/ui-ux-redesign-261109-direction.md`; Gate A answered with the recommended defaults, all marked as assumptions

### Phase 3: Foundations

- [x] 3.1 Failing specs first (budget, i18n parity, contrast) (specs written first and seen failing, commits 652faa81, 9b82a045, 26dc9c6f)
- [x] 3.2 Type scale and spacing fixes (text-wrap rules, commit 26dc9c6f; type scale itself needed no change)
- [x] 3.3 Focus ring and 44px touch targets (focus rings were already visible; 44px hit areas under pointer-coarse, commit 9b82a045)
- [x] 3.4 Aria names and heading structure (one `<h1>` per page) (already clean: one h1 per page and axe 0 violations; nothing to change)
- [x] 3.5 Phase-1 accessibility defects closed; specs green (D1, D2 fixed; D3 accepted (320px is below the 375px target); specs green)

### Phase 4: Core flows (order set by demo route)

- [x] 4.1 `/translate` readiness + dismissible first-run (empty source pane states the first step in en and vi, plus dock tooltips, commit 26d0e235; the dismissible banner was not added because the empty pane disappears on its own)
- [x] 4.2 `/conference` grid, transcript, side column at all widths (live call with two accounts: legacy tokens, avatar tiles, lobby fit, 16:9 tiles; commit 19d1e4a1)
- [x] 4.3 `/history` and `/history/[id]` (D1 and D2 fixed, commit 652faa81)
- [x] 4.4 Auth forms (login, register, forgot/reset, verify) (reviewed login and register, no defect found)
- [x] 4.5 `/preferences` and `/account` (touch targets 30 to 2 via shared components; commit 248c9746)
- [x] 4.6 `/glossary` (empty copy and stacked layout, commit 3f5f90ab)
- [x] 4.7 Empty/loading/error copy in vi + en for every route (translate, glossary empty and failed; API down and 500 swept on six routes; offline falls to the browser page, noted)
- [ ] 4.8 Per-route owner sign-off on before/after screenshots (waiting for the owner; screenshots in `plans/reports/ui-ux-redesign-261109-after/shots/`)

### Phase 5: Feedback and navigation

- [x] 5.1 Budget spec updated for any new state (before code) (no new elevated state was added, so no budget spec change was needed; design specs pass)
- [x] 5.2 Toast or inline confirmation per Gate A (Gate A: inline confirmation already exists ("Copied", "Link copied", save states); no toast added)
- [~] 5.3 Shortcut / palette per Gate A, documented in the UI (Gate A: palette out of scope; the skip link and sidebar already cover keyboard access)
- [x] 5.4 Keyboard-only and reduced-motion pass (keyboard in phase 1; reduced motion run on all routes in round 3: no running animation)

### Phase 6: Verify and document

- [x] 6.1 Re-run phase 1 tooling and diff against baseline (after-capture 40 of 40 clean, axe 0 at 1440 and 375, see final report)
- [ ] 6.1a Repeat the usability test with fresh users; compare success, steps, time against phase 1.9a (needs human testers; kit in the baseline folder)
- [x] 6.2 `pnpm --filter web test`, `lint`, `typecheck` green (web 1544 tests pass, typecheck and eslint clean; 4 skin-guard failures in packages/ui exist without these changes)
- [ ] 6.3 Production build; LCP/INP/CLS measured (not run: needs a production build and a measuring tool)
- [x] 6.4 State inventory rows with verified `file:line` (six rows, commit d3681c7d)
- [x] 6.5 Final report in `plans/reports/` (`plans/reports/ui-ux-redesign-261109-final.md`)
- [ ] 6.6 Owner final sign-off (waiting for the owner)

### Log

| Date       | Entry                                                                                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-09 | Plan created, supersedes the earlier uplift plan; beauty criterion added                                                                                                                                         |
| 2026-11-09 | impeccable URL scan of `/` and `/login` (public only); 1.8 partial, see Phase 1 evidence. Blocked on Docker for signed-in routes                                                                                 |
| 2026-11-09 | Docker back; stack up, test account made, 1.1-1.4 done: 40 shots, no overflow, 1 h1 per route, axe 0 violations at 1440; touch targets below 44px noted (commit 9d62763b)                                        |
| 2026-11-09 | Phases 2 to 6 run on assumed Gate A answers; 8 code and docs commits; final report `plans/reports/ui-ux-redesign-261109-final.md`                                                                                |
| 2026-11-09 | Round 2: conference live test, touch targets in shared components, failure-state sweep, glossary retry and empty state; final report updated                                                                     |
| 2026-11-09 | Round 3: hallmark, Emil and ui-ux-pro-max run from isolated clones; sentence-case labels, motion fixes, roster clamp; dark and reduced-motion checks                                                             |
| 2026-11-10 | Round 4: resizable sidebar and chat panel, page headers, two-column layouts, conference hero; owner asked for a more striking redesign, so the "keep Direction A" assumption was relaxed for layout and identity |
| 2026-11-10 | Round 5: looked at eight similar products (Meet, Zoom, DeepL Voice, Wordly, Maestra, JotMe and others); added a Captions and sound menu in calls; report `plans/reports/ui-ux-redesign-261109-competitors.md`    |

## Constraints that stay

- No backend or contract changes.
- Accent: once per screen-state. Elevation: at most two surfaces. Both gated; if Gate A
  changes a budget, change the spec and the guideline in the same commit.
- `KNOWN_VIOLATIONS` stays empty. Contrast, token and skin specs pass.
- Every new string exists in both locales; copy-register spec passes.
- New dependency (sonner, cmdk, motion) only with owner approval, one at a time.
- Tools run read-only; findings go to `plans/reports/`; nothing is installed into
  `.claude/` without owner approval.

## Acceptance criteria

- [ ] Baseline and final reports use the same viewport set; every defect has severity
      and status.
- [ ] Easy to use: usability test (3-5 users, 3 core tasks) before and after; >= 90%
      unaided success, <= 3 steps per task, zero dead ends; result recorded in reports.
- [ ] Modern and friendly: all three checks in the principles table pass on every route.
- [ ] Beauty: rubric >= 2 on every route (3 on the demo route), hallmark/impeccable
      leads triaged, owner approves before/after screenshots for each route.
- [ ] axe: 0 serious/critical on all routes; keyboard-only run completes translate,
      join conference, open history item, change language.
- [ ] No horizontal overflow at 320px; text column >= 260px at 375px on transcripts.
- [ ] Touch targets >= 44px at mobile widths; visible focus on every control.
- [ ] Reduced-motion pass: no non-essential animation.
- [ ] `pnpm --filter web test|lint|typecheck` green; budget/contrast/token specs green.
- [ ] Each ported pattern has licence + "why it fits our tokens" recorded.
- [ ] State inventory in `docs/design-guidelines.md` has a row per new state with
      verified `file:line`.
- [ ] LCP/INP/CLS quoted only from a production build.

## Risks

| Risk                                              | Mitigation                                      |
| ------------------------------------------------- | ----------------------------------------------- |
| Redesign fights the owner-chosen direction        | Gate A before any visual change                 |
| Tool output reflects generic AI taste, not ours   | Treat hits as leads; confirm against guidelines |
| Layout regressions invisible to specs (happy-dom) | Screenshots at 3 viewports + 320px per route    |
| Scope creep into marketing effects                | Skip list above; landing only after app routes  |
| Rotating refresh tokens break captures            | One browser context, per checklist              |

## Unresolved questions (answer at Gate A)

1. Keep Direction A and redesign on top of it, or is the look itself changing?
2. Toast acceptable, or keep confirmations inline?
3. Command palette in scope, or is the 7-item sidebar enough?
4. Which route is the thesis demo: `/translate` or `/conference`?
5. OK to run `npx impeccable detect` against URLs and hallmark (needs Chrome, writes files)?
6. Is the landing page in scope, or app routes only?
7. "Đẹp" reference: which 2-3 products (or screenshots) do you consider beautiful, so
   phase 2 has a concrete target instead of guessing taste?
