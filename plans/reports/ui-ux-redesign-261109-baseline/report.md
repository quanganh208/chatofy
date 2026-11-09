# UI/UX redesign: baseline audit (phase 1, in progress)

Date: 2026-11-09. Build: `next dev` (Turbopack) on :3001, api on :3000, test account
`uxaudit.test@example.com` (local only, delete at the end of phase 1). Dev server, so
no LCP/INP/CLS figures here; those come from a production build in phase 6.

Raw data: `capture-results.json`. Screenshots: `shots/<route>-<viewport>.png`.
Script: `capture.mjs` (needs `npm i axe-core` beside it; Chrome path set inside; credentials via `UXAUDIT_EMAIL` / `UXAUDIT_PASSWORD`).

## Status of steps

| Step                                           | State                                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1.1 stack up                                   | done                                                                                                                  |
| 1.2 test account                               | done (registered, verified by token, signed in via real `/login` form)                                                |
| 1.3 screenshots                                | done for 10 of 11 routes x 4 viewports (40 shots); `/history/[id]` not captured: no conversation exists yet           |
| 1.4 axe                                        | done at 1440 for 10 routes                                                                                            |
| 1.5 keyboard walk                              | done at page level (see Keyboard walk); task walks that need mic or data are deferred to 1.6                          |
| 1.6 worst-case data                            | done for history (seeded 3 conversations through the real API); empty, offline and error states still to check in 1.7 |
| 1.7 rubric scoring                             | todo                                                                                                                  |
| 1.8 impeccable URL scan, hallmark, Emil skills | todo                                                                                                                  |
| 1.9a usability test                            | todo (needs real testers)                                                                                             |
| 1.9 finish report, cleanup                     | todo                                                                                                                  |

## Environment findings (not UI defects, but they block anyone running the app)

1. `pnpm` is not on PATH. Husky's pre-commit calls `pnpm`; commits fail until it is
   (workaround used: a `pnpm` shim over `corepack pnpm`).
2. Repo wants Node >= 26 (`.nvmrc`); shell default was 22.14, where `nest start` crashes
   with `ERR_REQUIRE_CYCLE_MODULE`. fnm has 26.13 installed but Node 26 ships without
   corepack, so pnpm was run from the corepack cache.
3. `apps/web` `dev` script uses `${WEB_PORT:-3001}`, which `pnpm` on Windows (cmd)
   does not expand: `next dev` fails with "argument is invalid". Worked around with
   `pnpm exec next dev -p 3001`.
4. Workspace packages (`ai-providers`, `types`, `api-client`, ...) had stale `dist`
   builds: api showed 36-51 TS errors and web showed the Next build-error overlay on
   every signed-in page until `pnpm --filter "<app>^..." build` was run.
5. Database was empty: `prisma migrate deploy` was needed before register worked.

## Results from measurement

Overflow: none at 1440, 768, 375 or 320 on any of the 10 routes.
Headings: exactly one `<h1>` on every route.
axe (WCAG 2.0/2.1/2.2 A+AA, 1440px): 0 violations on all 10 routes. Only the desktop
width was scanned; 375px is still to do.
Console: no errors except `/preferences` returning 500 twice (the TTS voice list, an
expected error when the TTS sidecar is off, per the checklist).

### Targets under 44px (plan goal; WCAG 2.2 AA minimum is 24px, so these pass AA)

At 375px, on every signed-in page:

| Control                                            | Size     |
| -------------------------------------------------- | -------- |
| Colour theme buttons (Light / Dark / Match system) | 26 x 26  |
| Toggle the sidebar                                 | 28 x 28  |
| Language button                                    | 32 x 32  |
| Auth inputs and "Continue with Google"             | 277 x 40 |

`/preferences` has 37 targets under 44px at 375px (switches and rows), the most of any
route. The theme triple at 26px is the clearest candidate for phase 3.

## Visual observations (from screenshots, first pass, not yet scored)

Strengths: calm editorial look holds; one ink-filled action per screen
("Start conversation", "New meeting"); mobile layouts reflow cleanly with no clipping.

Leads to confirm in phase 1.7 and phase 2:

- `/translate/one-way` at 1440: the sidebar renders as an icon-only rail, while
  `/conference` shows it expanded. Check whether this is remembered state or a
  per-route inconsistency.
- Icon-only buttons bottom-right of `/translate` (three unlabelled controls) and a
  row of dots next to "Not listening" with no explanation. Discoverability risk for
  first-time users.
- Two large empty panels before the first session: no guided first run
  (plan phase 4 item).
- `/conference` landing is sparse: heading, one action, one field, a lot of empty
  space; "Join" is a low-contrast disabled button until a code is typed.
- The Next dev indicator badge overlaps the sidebar profile row (dev only, ignore).

## Keyboard walk (step 1.5, signed in, 1440px, Tab only)

Script: `keyboard.mjs`, data: `keyboard-results.json`. Same credentials env vars as the capture script.

| Route                         | Focus stops in one cycle | Tabs to the primary action              |
| ----------------------------- | ------------------------ | --------------------------------------- |
| /                             | 15                       | 10                                      |
| /translate/one-way            | 48                       | 20 (Start conversation)                 |
| /translate/two-way            | 48                       | 20                                      |
| /conference                   | 32                       | 14 (New meeting)                        |
| /history, /glossary, /account | 28 to 34                 | not measured (no single primary action) |
| /preferences                  | 48                       | not measured                            |

Findings:

- Every real control shows a visible focus indicator. The only stops without one are
  the Next.js dev overlay (`nextjs-portal`, dev only, ignore).
- "Skip to content" is the first stop on every signed-in page, so a keyboard user can
  jump past the sidebar. Without it, Start conversation is 20 Tabs away because the
  sidebar, theme, language and account controls come first.
- No focus trap: Tab wraps back to the start on every page.
- Not walked yet: change language end to end, join a conference with a code, open a
  history item (needs a seeded conversation), start a translation (needs a microphone).

## Worst-case data: /history and /history/[id] (step 1.6)

Seeded through `PUT /conversations/:id` (`seed.mjs`): a 24-turn two-way conversation with long
Vietnamese and English turns and a 63-character speaker label; an edge case with a 100-character
speaker label, a 180-character unbroken token and a long URL; a one-word conversation.
Measured by `history.mjs` (data: `history-results.json`, shots: `shots/history-seeded-*`, `shots/history-detail-*`).

| Page                      | 1440                         | 768              | 375              | 320              |
| ------------------------- | ---------------------------- | ---------------- | ---------------- | ---------------- |
| /history list             | overflows (scrollWidth 1492) | overflows (1236) | overflows (916)  | overflows (916)  |
| Detail: long conversation | ok, text column 574          | ok, 414          | ok, 277          | ok, 222          |
| Detail: edge case         | overflows (2605)             | overflows (2349) | overflows (2086) | overflows (2086) |
| Detail: one word          | ok                           | ok               | ok               | ok               |

axe at 1440 and 375 on these pages: 0 violations.

### Defects

| #   | Severity | Where                                 | What                                                                                                                                                                                         | Likely fix                                                           |
| --- | -------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| D1  | Medium   | /history list, "N speakers: ..." line | A speaker name with no spaces is not wrapped or truncated, so the whole page scrolls sideways at every width. The title above it truncates correctly, so only this line is missing the rule. | Same truncation or `break-words` plus `min-w-0` on the speakers line |
| D2  | Medium   | /history/[id] transcript              | An unbroken token or long URL in a turn overflows the page at every width (scrollWidth 2086 to 2605). URLs in transcripts are plausible, not only a test artefact.                           | `overflow-wrap: anywhere` on turn text                               |
| D3  | Low      | /history/[id] at 320px                | Text column is 208 to 222px; the checklist target (260px) is for 375px, where it passes (263 to 277).                                                                                        | Reduce side padding below 375px, or accept at 320                    |

The normal long conversation reads well at every width: the layout holds up, and the two
failures need unbroken strings, so they are edge cases rather than the common path.

## Next

Steps 1.6 to 1.9 per `plan.md`. Hallmark needs puppeteer + writes files, so it will be
run only after the owner approves the install.
