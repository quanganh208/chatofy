# Phase 5 — Demo polish, edge cases, runbook, end-to-end smoke

**Goal:** the difference between "works on my two tabs" and "survives a live thesis demo". Handle
the obvious failure states gracefully, write a runbook anyone can follow, and prove the whole flow
end-to-end on one host.

## Files this phase owns

- `apps/web/app/(app)/conference/**` (edit: add the handled states below — no new components
  unless a state needs one).
- `apps/web/src/hooks/use-conference.ts` (edit: surface error/permission/disconnect states).
- `docs/conference-demo-runbook.md` (new) — the demo operator's guide.
- `docs/project-roadmap.md` (edit: mark the demo-ready milestone + remaining gates).

## Edge cases to handle (no crash, a clear state each)

1. **Mic/camera permission denied** → join audio-only or show a "grant camera" prompt; never a
   white-screen throw. (The PoC assumes `getUserMedia({audio,video})` always succeeds.)
2. **Not signed in** → redirect to sign-in (the hook already detects a missing `accessToken`;
   surface it as a route, not a log line).
3. **WS disconnect / heartbeat eviction mid-call** → show a reconnecting/"call ended" state and
   return to the lobby cleanly; ensure `leave()` closes transports + the translate socket +
   audio contexts (no held mic).
4. **Empty room / waiting** → the "waiting for others" state from tokens, not the PoC's gray box.
5. **Duplicate-tab / same-user twice** → verify the roster + self-filter behave (each tab is a
   distinct socketId, which is fine).

## Runbook (`docs/conference-demo-runbook.md`) must contain

- Exact start sequence: `pnpm dev:all` (brings up Postgres, Redis, both speech sidecars), env
  needed (`AUTH_JWT_SECRET`, `GEMINI_API_KEY`, demo concurrency env from Phase 3), and the URLs.
- The demo script: create a room, share the link, each guest picks their language, speak in short
  turns, point out the subtitle appearing before the translated audio.
- **Known demo risks, stated plainly** (not hidden): one-host/loopback only — cross-network media
  (#208) and mobile (#210) are untested; multi-speaker concurrent translation load not formally
  measured; translated audio lags ~6 s warm.
- Reset/cleanup between runs; how to stop everything (`pnpm dev:stop`).

## Steps

1. Implement the five handled states above.
2. Write the runbook; **execute it from a clean checkout** on one machine and fix whatever the
   runbook got wrong (it is only done when it reproduces the demo).
3. End-to-end smoke: 3 browser profiles (2 vi + 1 en, or similar), full flow — create/join,
   video, both-direction translation (Phase 3), mute/cam/leave (Phase 2), optional chat (Phase 4
   if built). Capture a short note of what worked / any residual stutter.
4. Update the roadmap's video-meetings section to "demo-ready on `video-conferencing` branch" and
   list the still-open production gates.

## Verification

- `pnpm lint && pnpm typecheck && pnpm build` all green.
- Each edge case reproduces its handled state (deny camera in a profile; kill the api mid-call;
  open an empty room) with no uncaught error.
- A second person (or a clean checkout) follows `docs/conference-demo-runbook.md` and reaches a
  working 2–3 party translated meeting without extra instruction.

## Acceptance criteria

- No unhandled failure state in the demo flow; runbook reproduces the demo end-to-end on one host;
  roadmap reflects demo-ready + remaining gates.

## Risk / rollback

Mostly additive state handling + docs. Rollback per file; the runbook and roadmap edits are
revertible and carry no runtime effect.
