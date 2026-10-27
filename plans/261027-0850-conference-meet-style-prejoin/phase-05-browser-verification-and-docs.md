---
phase: 5
title: 'Verification in a real browser and docs'
status: completed
priority: P1
effort: '4h'
dependencies: [1, 2, 3, 4]
---

# Phase 5: Verification in a real browser and docs

## Goal

Prove the new flow in a real browser with two signed-in users, at the three
required viewports, then update the docs that describe the old lobby.

## Context the executor needs

- **Production runs on this machine.** Never run `pnpm dev:all` and never start
  dev STT/TTS sidecars: the 8 GB Docker VM is shared with production, and dev
  speech sidecars have OOM-killed production STT before. Port 5433 is
  production's database — do not touch it. Translation is not under test here,
  so only Postgres, Redis, API and web are needed.
- Dev containers `chatofy-postgres-1` (:5432) and `chatofy-redis-1` (:6379)
  are normally already up (compose project `chatofy`). Production is
  `docker-compose.prod.yml`, project `chatofy_prod`, ports 5433/6380 — never
  run compose commands against it. Leave the dev containers running at the end.
- `apps/api/.env` already holds the Cloudflare Realtime credentials the API
  refuses to boot without. Do not open, print or edit them.
- STT/TTS are not running, so an in-call "translation ended" notice
  (`[data-translation-ended]`) is EXPECTED and is not a failure.
- Start: `docker compose up -d --wait postgres redis` (a no-op when already up), then
  `pnpm --filter api dev` (port 3000) and `pnpm --filter web dev` (port 3001),
  each with the harness's background-run facility. Before starting, check the
  ports with `ss -ltnp | grep -E ':(3000|3001) '`; if a stale dev process of this
  repo holds a port, stop it — never pick another port. Stop both at the end of
  the phase.
- Accounts: two throwaway local accounts. `POST http://localhost:3000/auth/register`
  (no `/api` prefix); the verification link is printed in the API console (SMTP
  unset); `POST /auth/verify-email {token}`. Give them names "An Nguyen" and
  "Binh Tran". Delete both `User` rows afterwards (dev DB user and database are
  both `chatofy`). Back up first: `docker compose exec postgres pg_dump -U chatofy chatofy > /tmp/…` (use the session scratchpad path).
- Use **one Playwright browser context per account** for the whole run. Replaying
  a saved `storageState` into a new context trips refresh-token reuse detection
  and logs the user out mid-run. Launch Chromium with
  `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` so camera
  and mic exist and permission prompts are auto-accepted.
- Playwright recipe: write the script as `plans/261027-0850-conference-meet-style-prejoin/verify-prejoin.mjs`
  and load Playwright with
  `createRequire('/home/quanganh208/Documents/QuangAnh/chatofy/apps/extension/package.json')('playwright')`
  (Playwright 1.64.1 and its Chromium are installed there). Run it with
  `node plans/261027-0850-conference-meet-style-prejoin/verify-prejoin.mjs`.
  Never put the words `node_modules` or `build` in a shell command — a hook
  blocks such commands.
- `next dev` compiles a route on first visit (can take >30 s): after each first
  navigation wait for `networkidle` and use 60 s timeouts.
- `SegmentedControl` options are `role="radio"`; the selected one has
  `aria-checked="true"`.
- Write screenshots to `plans/261027-0850-conference-meet-style-prejoin/screenshots/`.

## Tasks

### Task 5.1 — Full workspace gates

- Verify: each of these exits 0: `pnpm --filter @chatofy/i18n test`, `pnpm --filter web typecheck`, `pnpm --filter web lint`, `pnpm --filter web test`, `pnpm --filter mobile typecheck`, `pnpm --filter mobile lint`, `pnpm --filter mobile test`.

### Task 5.2 — Signed-in flow, user A

- Steps (context A, viewport 1440×900):
  1. Open `http://localhost:3001/conference`. Assert text "Joining as An Nguyen" is visible and there is no `#conf-name` on this page. Screenshot `landing-1440.png`.
  2. Click "New meeting". Assert the URL matches `^http://localhost:3001/conference/[a-z0-9]+$` (no query string). Assert `#conf-name` has value `An Nguyen`. Assert `[role="meter"]` exists and its `aria-valuenow` becomes greater than 0 within 5 s (the fake device produces a tone). Screenshot `prejoin-1440.png`.
  3. Click the voice chip (`[data-conference-voice-chip]`), click `[role="radio"]` named "Male", click `[role="radio"]` named `1.25×`. Assert the chip text contains `Male` and `1.25`. Screenshot `prejoin-voice-open-1440.png`. Open `http://localhost:3001/translate` in the same context, open its voice settings (`button[aria-label^="Voice settings"]`), and assert the `[role="radio"]` named `1.25×` has `aria-checked="true"`. Go back to the room URL.
  4. Click "Join now". Assert the in-call screen appears (the Leave button is visible) within 15 s.
  5. Click "Copy invite link" (grant `clipboard-read`/`clipboard-write` permissions to the context). Read the clipboard with `navigator.clipboard.readText()` and assert it equals the room URL with no query.
- Verify: every assertion above passes; the script exits 0.

### Task 5.3 — Shared link and signed-out return, user B

- Steps:
  1. In a fresh context with no session, open the room URL from 5.2. Assert it lands on `/login` with a `next` query containing `/conference/`.
  2. Sign in as Binh Tran in that form. Assert the browser returns to the room URL and shows `#conf-name` with value `Binh Tran`.
  3. Click "Join now". In context A, assert a second tile or roster entry named "Binh Tran" appears within 15 s.
- Verify: every assertion passes.

### Task 5.4 — Viewports

- Steps: in context B before joining (repeat 5.3 step 2 on a new room if needed) and on the landing page, capture `landing-768.png`, `landing-375.png`, `prejoin-768.png`, `prejoin-375.png` at 768×1024 and 375×812.
- Verify: for each screenshot, `document.documentElement.scrollWidth <= window.innerWidth` evaluates to `true` (no horizontal scroll), and "Join now" is inside the viewport after scrolling it into view. Then open each PNG and confirm, against `docs/design-guidelines.md`, that only one control is accent-filled. Record that visual check as a pass/fail line per file in the phase report.

### Task 5.5 — Docs

- Target files: `docs/architecture/video-client-support.md` (section `### 4.1 Pre-join (lobby)`, lines ~261-291 only — the table near line 353 is the MOBILE table, leave it), `docs/conference-demo-runbook.md` (steps around lines 94–130 and line 184).
- Steps:
  1. Replace the 4.1 ASCII sketch and its text with the new landing (New meeting + code/link + "Joining as") and the green room (preview, meter, toggles, pickers, name, language, voice chip, Join now). State that the share link is `/conference/<roomId>` only, and that guests are not supported (accounts only; signed-out visitors go through `/login?next=`).
  2. In 4.1's gate paragraph (around lines 286-291), replace "Gated by three rows … (plain, opened from a shared link, refusing to create without a name)" with: two landing rows (plain, opened from an old `?room=` link) and two pre-join rows (plain; voice popover open, 1 surface). Delete the bullet saying there are no device pickers / the preview is camera-only — it is now false.
  3. In the runbook demo script, replace "type a name and click **Create a room**" with "click **New meeting**, check the preview and the voice chip, click **Join now**", and say the second profile opens the copied invite link.
  4. Mobile: one sentence in the runbook's mobile section that the lobby now has a Translated voice (Female/Male) picker.
- Verify: `grep -c "Join now" docs/architecture/video-client-support.md docs/conference-demo-runbook.md` prints a count of at least 1 for each file.

### Task 5.6 — Clean up

- Steps:
  1. Stop the API and web dev processes you started.
  2. `Conference.ownerId` and `ConferenceParticipant.userId` have no foreign key to `User`, so delete the test rooms first (participants, turns and messages cascade from `Conference`): `docker compose exec postgres psql -U chatofy chatofy -c "delete from \"Conference\" where \"ownerId\" in (select id from \"User\" where name in ('An Nguyen','Binh Tran'))"`.
  3. Then delete the two users: `docker compose exec postgres psql -U chatofy chatofy -c "delete from \"User\" where name in ('An Nguyen','Binh Tran')"`.
  4. Leave the Postgres/Redis containers running.
- Verify: `ss -ltnp | grep -E ':(3000|3001) '` prints nothing (grep exit 1 is the PASS); `docker compose exec postgres psql -U chatofy chatofy -tc "select count(*) from \"User\" where name in ('An Nguyen','Binh Tran')"` prints `0`; `docker compose exec postgres psql -U chatofy chatofy -tc "select count(*) from \"ConferenceParticipant\" p left join \"User\" u on u.id = p.\"userId\" where u.id is null"` prints the same number it printed before task 5.2 (record that baseline before 5.2 starts).

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:

- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
  Apply kongming's guidance, then re-run the Verify step.
  If `kongming` cannot be spawned in this environment, STOP and report the same
  failure evidence to the user. Never continue by self-reasoning.
