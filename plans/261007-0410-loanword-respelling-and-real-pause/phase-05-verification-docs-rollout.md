---
phase: 5
title: 'Verification, docs and rollout'
status: in-progress
priority: P1
effort: '4h'
dependencies: [2, 3, 4]
---

# Phase 5: Verification, docs and rollout

## Goal

Prove the acceptance criteria on real audio, record the measurements, and ship.

## Steps

1. **Local replay of cd64f34f.** The recording is on R2; the URL is in the quality report. Feed it through `CapturePump` with the web settings (`continuous`, `fullDuplex`, `maxUtteranceMs` 8000) against the local API and check that:
   - the turn 0 and turn 4 displays contain "deepfake";
   - `sourceText` is unchanged;
   - turn 4's STT already says "deepfake", from the learned hotword;
   - no other turn's text regresses.
2. **Offline ruler** (`benchmarks/loanword-respelling/score.mjs`) on the 50 dumped prod vi turns:
   - at least the 9 right, at most 1 wrong;
   - correct loanwords untouched.
3. **Prompt-injection benchmark,** full run including the `respell` arm.
4. **Full gates:** `pnpm -w typecheck && pnpm -w lint && pnpm -w test && pnpm -w build`.
5. **Docs.**
   - Add a §3.x entry to `docs/development-journey.md` covering:
     - the structural detector;
     - the arm A vs arm B numbers;
     - the guards;
     - the hotword probe;
     - the latency measured in phase 2;
     - the explicit boundary change on the display path, relative to §3.14.
   - Update `docs/architecture/data-flow.md` for the display composition (restore, respell guard, ITN).
   - Update the conversation save contract for `pausedMs` wherever the docs describe `endedAt − startedAt`.
6. **Rollout.** This needs the user's confirmation, because it is outward-facing. Back up the prod database (`pg_dump` inside `chatofy_prod_postgres`), then deploy and run the migration.
7. **Post-deploy check.** Replay the same recording on the prod WebSocket under the owner account, with a 1 h token minted in the container and never printed. Report counts only.

## Verification

- Every acceptance row in `plan.md` is ticked with its evidence (a command output or a log line).

## Progress (2026-10-07)

- [x] **1. Local replay of cd64f34f** through this branch's API (port 3100, dev DB, prod sidecars read-only):
  - All 10 finals arrived.
  - Turn 0 `sourceText` reads "deep f" and its display reads "deepfake" (respell 694–865 ms, accepted 1/1).
  - The learned hotword reached all 9 later decodes, live preview included.
  - Turn 7's recognizer already wrote "deepfake".
  - Everything started was stopped: the API, and dev postgres/redis. The dev user row was deleted, and the dev DB was backed up before migrate.
- [x] **2. Ruler:** 9 right, 1 wrong, 1 kept and 1 missed in each of 3 runs, re-run after the review fixes.
- [x] **3. Injection arm:** 18/18 passed, and the guard was never the only defence.
- [x] **4. Gates:**
  - typecheck: 16/16 tasks.
  - tests: api 1298, web 1039, realtime-client 462, ai-providers 117, types 105, i18n 15.
  - lint: 0 errors.
  - `pnpm --filter web build`: OK.
- [x] **5. Docs:**
  - `docs/development-journey.md`: two entries.
  - `docs/architecture/data-flow.md`: display composition.
  - `docs/architecture/ai-providers.md`: active-time offsets and `pausedMs`.
- [ ] **6. Rollout:** needs user confirmation. Commit, PR, prod `pg_dump`, deploy, `migrate deploy`.
- [ ] **7. Post-deploy replay** on prod under the owner account.
