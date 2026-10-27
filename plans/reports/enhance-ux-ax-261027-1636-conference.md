# UX/AX review: chatofy /conference — 2026-10-27

## Verdict

The biggest win is the in-call screen on phones and tablets: the roster opens by default and squeezes two video tiles into 72px-wide strips at 375px. The second is structural: three screens carry two `<h1>`, and `robots.txt` does not disallow `/conference` although the proxy gates it. DONE status: **all eight contract lines pass** (round log below); every proposal shipped, P7 with a recorded change of form.

## Scope and environment

- Mode `--auto`, focus `/conference` (landing, pre-join, in-call alone and with a peer, ended, room-not-found).
- Local dev: `pnpm --filter api dev` (:3000), `pnpm --filter web dev` (:3001), branch `quanganh208/feat/conference-prejoin` (uncommitted). Two throwaway local accounts, one Chromium context each, fake camera and mic. This follows the project's signed-in review rule in `docs/ux-ax-review-checklist.md`, which overrides the skill default of asking the user to sign in.
- Design authority: `docs/design-guidelines.md` (the project's DESIGN.md); review checklist: `docs/ux-ax-review-checklist.md` (its REVIEW.md).
- Not run: performance (a dev server is not a valid measurement, per the checklist); translation (speech sidecars are off because production shares this host).

## Baseline evidence

Screenshots in `enhance-ux-ax-261027-1636-conference/round-1/` named `<viewport>-<page>.png` for viewports desktop 1440×900, tablet 768×1024, mobile 375×812, with a 320px reflow measurement per page in `round-1/metrics.json`.

| Page                       | Measured                                                                        | Seen                                                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| landing, landing-bad-code  | no h-scroll at any width; 2 × `<h1>` (topbar "Conference" + "Video conference") | clear single action; no brand cue                                                                                                                                                                                                                                      |
| prejoin                    | no h-scroll; 2 × `<h1>`                                                         | strong after the earlier colour pass                                                                                                                                                                                                                                   |
| in-call-alone, in-call-two | no h-scroll; 1 × `<h1>`                                                         | **mobile: roster open by default takes 208 of 375px; tiles 72px wide, names wrap** (`mobile-in-call-two.png`); tablet tiles are tall portrait strips (`tablet-in-call-two.png`); header shows a raw cuid; chat placeholder truncated to "Type a messag" at every width |
| ended                      | no h-scroll; 2 × `<h1>`                                                         | fine                                                                                                                                                                                                                                                                   |
| room-not-found             | no h-scroll                                                                     | one sentence and a button; no next step                                                                                                                                                                                                                                |

Console errors: none (both accounts). Keyboard: Tab order on the landing reaches New meeting after the topbar controls, focus ring visible on each. No control under 24px.

Discovery scan (`--site-origin https://chatofy.quanganh208.dev`): exit 0, one accepted warning (`llms-full.txt`, accepted in the checklist). Source inspection: `apps/web/app/robots.ts` disallows `/translate`, `/history`, `/preferences`, `/account` but **not `/conference`**, which `proxy.ts` gates. Nothing ties the list to the nav, which is how it drifted.

## Scores

| Area                  | Score 0–3  | Evidence                                                                                                  |
| --------------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| First impression      | 2          | landing purpose and one action clear (`desktop-landing.png`)                                              |
| Brand recall          | 1          | landing has no brand cue; only pre-join carries the dawn (`desktop-landing.png` vs `desktop-prejoin.png`) |
| Content punch         | 2          | "New meeting", "Join now", "Ready to join?" — verb + object                                               |
| Clarity and hierarchy | 1          | two `<h1>` on three screens; raw room id as the in-call header (`desktop-in-call-two.png`)                |
| Storytelling          | n/a        | app screens, not a narrative page                                                                         |
| Knowledge and trust   | 2          | voice popover explains who hears the voice                                                                |
| Motion                | 2          | state transitions only; meter respects reduced motion                                                     |
| Responsive            | 1          | `mobile-in-call-two.png`, `tablet-in-call-two.png`                                                        |
| Accessibility         | 1          | duplicate `<h1>`; otherwise labelled controls, visible focus                                              |
| Performance feel      | unverified | dev server only                                                                                           |

## Proposals

### P1 — `robots.txt` disallows every signed-in route, gated by a spec (Must)

- Evidence: `curl /robots.txt` lists no `/conference`; `robots.ts:` disallow array.
- Change: add `/conference`; add a spec asserting every `navItems()` href is disallowed, so the next signed-in route cannot drift.
- Files: `apps/web/app/robots.ts`, new `apps/web/app/robots-covers-signed-in-routes.spec.ts`.
- Acceptance: `curl -s localhost:3001/robots.txt` contains `Disallow: /conference`; the spec passes, and fails when `/conference` is removed from the array.

### P2 — One `<h1>` per conference screen (Must)

- Evidence: `metrics.json` h1 = ["Conference", "Video conference"] / ["Conference", "Ready to join?"] / ["Conference", "Meeting ended"].
- Change: the topbar already renders the route's `<h1>`; the page headings become `<h2>` with the same look.
- Files: `apps/web/app/(app)/conference/page.tsx`, `[roomId]/components/pre-join-panel.tsx`, `[roomId]/ended/` heading.
- Acceptance: re-captured `metrics.json` shows exactly one `h1` on every conference page.

### P3 — In-call screen recomposed for phones and tablets (Must)

- Evidence: `mobile-in-call-two.png`, `tablet-in-call-two.png`.
- Change: the roster starts closed below the `md` breakpoint (it stays one tap away); when opened below `md` it overlays the grid at full width instead of squeezing it; two or three tiles stack in one column below `md`, so each tile keeps a landscape-ish shape.
- Files: `[roomId]/page.tsx`, `[roomId]/utils/video-layout.ts`.
- Acceptance: at 375×812 with two participants, each tile is ≥ 300px wide and names do not wrap; at 768×1024 tiles are wider than tall; desktop unchanged.

### P4 — A readable in-call header (Should)

- Evidence: header text `cmvqhtebg000cc4c3bo6faro8` alone (`desktop-in-call-two.png`).
- Change: label it ("Meeting code") and give the copy-link control a visible text label from `sm` up, so the way to invite is found without hovering an icon.
- Files: `[roomId]/page.tsx`, i18n `en.ts`/`vi.ts`.
- Acceptance: desktop screenshot shows "Meeting code" and "Copy invite link" as text; mobile keeps the icon with its aria-label.

### P5 — Side panel wide enough for its content (Should)

- Evidence: chat placeholder "Type a messag", own name "An Ngu…" at every width.
- Change: panel `w-52` → `w-64`, `xl:w-72`.
- Files: `[roomId]/page.tsx`.
- Acceptance: at 1440 the placeholder and both names render untruncated.

### P6 — Room-not-found names the next step (Should)

- Evidence: `desktop-room-not-found.png`.
- Change: add one hint line under the message: check the link or ask for a new invite.
- Files: `[roomId]/page.tsx`, i18n.
- Acceptance: screenshot shows the hint; still exactly one filled control.

### P7 — The landing carries the brand cue (Should)

- Evidence: Brand recall 1.
- Change: the same dawn glow the pre-join uses, behind the landing's action column (decoration only; no text on dawn).
- Files: `apps/web/app/(app)/conference/page.tsx`.
- Acceptance: landing screenshot shows the glow in light and dark; accent and surface counts unchanged (`accent-budget-app.spec.tsx` passes).

## DONE contract

1. P1–P7 meet their acceptance checks, or a skipped item has an accepted reason below.
2. The discovery scan exits 0 with only the accepted `llms-full.txt` warning.
3. Re-captured screenshots of every changed page at 1440, 768 and 375 show no overflow, clipping, overlap or broken image, and vision review finds no High issue; 320px reflow shows no horizontal scroll.
4. No rubric area regresses; Brand recall, Clarity, Responsive and Accessibility reach ≥ 2.
5. Keyboard: the roster toggle and copy-link control are reachable and show focus; reduced-motion unchanged.
6. `pnpm --filter web typecheck`, `lint`, `test` exit 0.
7. `docs/design-guidelines.md` / `docs/ux-ax-review-checklist.md` / `docs/architecture/video-client-support.md` reflect the changes; `AGENTS.md` already points agents at the design docs through `CLAUDE.md`.
8. Test accounts deleted; dev servers left running only because the user is reviewing the UI, and stopped on request.

## Round log

| Round | Proposals done | Checks passing                         | Regressions fixed                                                                    | Notes                                                                                                                                                                                                                                                      |
| ----- | -------------- | -------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | —              | baseline                               | —                                                                                    | `round-1/`                                                                                                                                                                                                                                                 |
| 2     | P1–P7          | h1 = 1 everywhere, no h-scroll, scan 0 | —                                                                                    | two misses seen in `round-2/`: mobile roster stayed open when the page mounted at 1440 then resized (`mobile-in-call-two.png`); tablet tiles still strips because the stack keyed on the viewport while the roster eats ⅓ of it (`tablet-in-call-two.png`) |
| 3     | P3 fixed       | all                                    | roster follows `(min-width: 768px)` changes; grid stacks by container query (`@2xl`) | `round-3/`: phone tiles 359px wide, tablet tiles 448×410, desktop unchanged                                                                                                                                                                                |

### Contract evidence

1. P1: `Disallow: /conference` served; spec passes, and fails with `/conference` removed (mutation run). P2: `round-3/metrics.json` one `h1` on all 29 rows. P3: `round-3/{mobile,tablet}-in-call-two.png`. P4, P5: `round-3/desktop-in-call-two.png` shows "MEETING CODE", "Copy invite link", "An Nguyen (You)" and "Type a message…" untruncated. P6: `round-3/mobile-room-not-found.png`. P7: **changed form** — a glow behind the landing column would sit behind the heading and copy, which the dawn rule forbids (never behind text), so the cue is a 96px dawn band above the heading (`round-3/desktop-landing.png`); accent and surface specs pass.
2. Scan exit 0; warnings only `llms-full.txt` (accepted in the checklist).
3. No h-scroll at 1440/768/375/320 on any page; vision review found no High issue. Medium, accepted: phone pre-join puts Join now below the fold (the screen scrolls, as before this review).
4. Brand recall 1→2 (landing band, pre-join dawn), Clarity 1→2, Responsive 1→2, Accessibility 1→2; no area lower.
5. New controls are the shared `Button` (focus-visible ring); the copy-link button keeps its `aria-label`. Landing Tab order unchanged (`metrics.json` keyboard row). No new motion.
6. `pnpm --filter web typecheck` 0, `lint` 0, `test` 1271 passed; i18n test 25 passed.
7. `docs/architecture/video-client-support.md` §4.2 (phones, tablets, header), `docs/ux-ax-review-checklist.md` (signed-in list, robots spec, two-account resize rule). `docs/design-guidelines.md` unchanged: no rule changed. `AGENTS.md` already routes to these docs.
8. Test accounts, their 3 rooms deleted; 0 orphan participants. Dev servers :3000/:3001 kept running because the user is viewing the UI.

## Unresolved questions

- The ended screen read "Duration: Not recorded" for a meeting of about 20 seconds. Not investigated in this round; it may be by design for meetings that end by everyone leaving.
