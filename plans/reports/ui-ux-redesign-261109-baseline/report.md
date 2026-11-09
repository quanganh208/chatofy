# UI/UX redesign: baseline audit (phase 1, in progress)

Date: 2026-11-09. Build: `next dev` (Turbopack) on :3001, api on :3000, test account
`uxaudit.test@example.com` (local only, delete at the end of phase 1). Dev server, so
no LCP/INP/CLS figures here; those come from a production build in phase 6.

Raw data: `capture-results.json`. Screenshots: `shots/<route>-<viewport>.png`.
Script: `capture.mjs` (needs `npm i axe-core` beside it; Chrome path set inside; credentials via `UXAUDIT_EMAIL` / `UXAUDIT_PASSWORD`).

## Status of steps

| Step                                           | State                                                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1.1 stack up                                   | done                                                                                                        |
| 1.2 test account                               | done (registered, verified by token, signed in via real `/login` form)                                      |
| 1.3 screenshots                                | done for 10 of 11 routes x 4 viewports (40 shots); `/history/[id]` not captured: no conversation exists yet |
| 1.4 axe                                        | done at 1440 for 10 routes                                                                                  |
| 1.5 keyboard walk                              | todo                                                                                                        |
| 1.6 worst-case data                            | todo                                                                                                        |
| 1.7 rubric scoring                             | todo                                                                                                        |
| 1.8 impeccable URL scan, hallmark, Emil skills | todo                                                                                                        |
| 1.9a usability test                            | todo (needs real testers)                                                                                   |
| 1.9 finish report, cleanup                     | todo                                                                                                        |

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

## Next

Steps 1.5 to 1.9 per `plan.md`. Hallmark needs puppeteer + writes files, so it will be
run only after the owner approves the install.
