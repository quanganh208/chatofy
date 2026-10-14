# Phase 4 — Auto-reconnect on a transient mid-call drop (item D)

**Goal:** a brief network blip should not end the meeting. Today a mid-call WS close sets
`status: 'disconnected'` and the user is sent back to the lobby. Add a bounded auto-rejoin: on an
unexpected close, show a "reconnecting" state and retry the full join a few times with backoff;
dead-end to the lobby only after the cap. This is the largest, riskiest item — run it LAST.

## Context (the join lifecycle to make re-runnable)

`useConference.join` is one `useCallback`: it opens the `/ws/conference` socket, and on `open`
runs the whole sequence (join → device load → getUserMedia → send/recv transports → produce →
wireTranslate → consume existing peers), then installs the message handler. Its `close` handler
currently sets `disconnected`. Reconnect needs the on-open sequence to be re-runnable and the
close handler to decide retry-vs-give-up.

## Files owned

- `apps/web/src/hooks/use-conference.ts` (edit) — extract the on-open join sequence into a
  re-runnable internal routine; add retry state (attempt counter, backoff), a `'reconnecting'`
  branch, and give-up-after-cap logic in the close handler; reuse the existing local media /
  transports where safe, or tear down and rebuild cleanly on each attempt.
- `apps/web/app/(app)/conference/[roomId]/page.tsx` (edit) — render a "reconnecting (n/N)…" state
  distinct from the terminal `disconnected` dead-end.
- `packages/i18n/src/en.ts` + `vi.ts` (edit) — reconnecting strings.

## Steps

1. **Refactor first, no behavior change:** pull the `ws.onopen` body into a named routine (e.g.
   `runJoinSequence(ws)`) that `join()` calls. Verify the call still behaves identically
   (typecheck + build + manual join still works) BEFORE adding retry — do not change the working
   path and add retry in one step.
2. **Add retry:** on an UNEXPECTED close (not from `leave()` — guard with the existing
   intentional-leave flag that already sets `idle` first), if attempts < cap (default 3), set
   `status: 'reconnecting'`, wait backoff (e.g. 1s/2s/4s), open a fresh socket and re-run the
   sequence. Fully tear down the prior attempt's transports/producers/consumers/sink contexts
   before rebuilding to avoid leaks or duplicate tiles. On success → `in-call`, reset the counter.
   On cap exhaustion → the existing `disconnected` terminal state (unchanged dead-end).
3. **State/UX:** page shows "reconnecting (n/N)…" during attempts; the terminal `disconnected`
   view is unchanged. i18n (en + vi), then `pnpm --filter @chatofy/i18n build`.

## Verification

- `pnpm --filter web typecheck` + `build` + `test` green.
- Step-1 refactor verified green on its own before retry is added.
- Logic check: an intentional `leave()` never triggers reconnect; an unexpected close retries up
  to the cap then dead-ends; each attempt tears down the prior attempt's media (no duplicate peer
  tiles, no leaked AudioContexts).
- Manual (live): kill the api mid-call briefly — the UI shows reconnecting and recovers when the
  api returns; kill it for longer — it dead-ends to the lobby after the cap.

## Acceptance

A transient drop auto-recovers with a visible reconnecting state; a sustained outage dead-ends
cleanly after the cap; intentional leave is unaffected. Specs green.

## Risk / rollback

Highest-risk item (edits the working join path). Mitigation: refactor-then-retry in two verified
steps; keep the terminal `disconnected` fallback. Rollback = revert to the single-shot join +
`disconnected` close handler (exactly today's behavior); nothing else depends on D.
