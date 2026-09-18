# Tail-turn loss: cmu4edytm001201pcn1uh8w8d

## Evidence gathered

DB (read-only, prod):

- `Conversation`: startedAt 17:47:19.210, endedAt 17:51:50.017 → wall = 270.807s.
  audioOffsetMs=171, audioDurationMs=270646 → offset+duration = 270.817s.
  **Delta = -10ms.** `endedAt` is stamped once, at the falling edge, by
  `useConversationSave.enqueue()` (`apps/web/src/hooks/use-conversation-save.ts:167`),
  fired from the effect that watches `running` (derived from session `status`).
  The recording's own clock stops the instant `ConversationSession.finish()` cuts
  the mic tracks (`packages/realtime-client/src/conversation/conversation-session.ts:434-436`).
  A ~10ms gap between "recording stopped" and "save fired" means **`stop()` ran in
  the same tick as `finish()`** — the graceful drain added ~0ms, not up to the 20s
  `DRAIN_TIMEOUT_MS` backstop.
- Last 6 `ConversationTurn` rows (position DESC): position 52 opens at offsetMs
  256119, text ends "...tôi đã đi thực tập rồi có cái gì đâu mà nghĩ". Position 51
  opens 255119 — only 1000ms after capturing began, i.e. turns are landing back to
  back near the end of this recording. Nothing at position 53 exists.
- Independent reference transcription (given) puts speech at ~4:22–4:30 of the
  270.539s media — "một công việc thì đi làm, có gì đâu. Có gì đâu mà nghĩ, nghĩ
  là nghĩ cái gì? Ủa cảm ơn" — content that does **not** appear in turn 52 or any
  other row. This is a distinct ~8s utterance, captured in the recording, with no
  matching `ConversationTurn`.
- No server-side log corroboration is available: `chatofy_prod_api`'s container
  restarted 2026-09-18T04:39 (today), so logs from the incident (2026-09-16) are
  gone, and there is no `TranslationSession`/turn table in Postgres — sessions are
  purely in-memory on the API. This closes off direct confirmation; the mechanism
  below is reconstructed from code + the wall-clock arithmetic above, which is
  tight enough to rule out the main alternative (see "Eliminated" below).

## Mechanism (client-side; proven by code, corroborated by the wall-clock delta)

Both the web page and the extension run `maxInFlight: 3`
(`apps/web/src/hooks/use-streaming-translate.ts:35`), matching the server's own
per-socket ceiling `MAX_CONCURRENT_TURNS_PER_SOCKET = 3`
(`apps/api/src/modules/translate/session/turn-concurrency.ts:27`). The server also
enforces a **process-wide** ceiling, `MAX_CONCURRENT_TURNS_GLOBAL = 6`
(same file, line 41), shared across every socket on the box. A turn refused by
the global ceiling — because OTHER users' turns filled the process, not this
client's own three — surfaces to this client exactly as `too_many_turns`, the same
code the per-socket ceiling would send.

`TurnPipeline.onError('too_many_turns', ...)` (`packages/realtime-client/src/conversation/turn-pipeline.ts:451-482`):

- Puts the turn back to `waiting` and retries every `REFUSAL_RETRY_MS` (750ms)
  via `scheduleRetry()` — this is required specifically for the global-ceiling
  case, "an event nothing here can observe" per the comment at line 64-69, so it
  polls blind.
- Bounded by `MAX_REFUSAL_RETRIES = 4`. On the 5th refusal
  (`turn.refusals > MAX_REFUSAL_RETRIES`, line 459) it gives up:
  `this.forget(turn, 'too_many_turns')` (line 464) — **turn deleted, no
  `server.session.start` ever having reached a live server session.** Total
  elapsed time from first refusal to giving up: ~4 × 750ms ≈ 3s.

`forget()` calls `handlers.onTurnClosed(turnId, 'too_many_turns')`
(turn-pipeline.ts:595), which in `ConversationSession` (conversation-session.ts:573-594):

```
onTurnClosed: (turnId, reason) => {
  ...
  this.reportTurnCapture(pipeline, turnId);   // no-op: turn never got a sessionId
  ordered.finish(turnId);                     // retires it from OrderedPlayback — fast, no server round trip
  if (!isServerReason(reason)) this.abandonTurn(turnId, reason);
  ...
}
```

`isServerReason()` (conversation-session.ts:938-940) excludes exactly three
self-invented reasons from being treated as a real server close:
`'never_started' | 'dropped_pending' | 'stopped'`. **`'too_many_turns'` is missing
from that list.** It reads as a server-originated close (the server did, after
all, send the _first_ refusal), so `abandonTurn()` — the only path that tells the
turn-keyed transcript reducer a turn existed and died — is never called. Combined
with `reportTurnCapture` also being a no-op (no `sessionId` was ever assigned),
**nothing reaches the UI or the save payload for this turn.** It is not marked
abandoned, not shown as a live line, and never becomes a `ConversationTurn` —
while the raw microphone audio, tapped independently by
`useConversationRecording`, keeps it in the stored recording.

This also explains the -10ms wall-clock delta: the whole give-up cycle (open →
4 refusals → forget) resolves in ~3s of its own accord, calling `ordered.finish()`
well before "End" was likely pressed (the person finishes the sentence, the turn
is already gone, then they press End into an already-quiet `ordered` — hence
`completeDrainIfDone()` in `finish()` sees `ordered.isBusy === false` immediately
and calls `stop()` in the same tick, with none of the 20s `DRAIN_TIMEOUT_MS`
elapsing).

## Eliminated

- **Server-side idle sweep / turn-timeline discard.** Would produce a real
  `server.session.ended` with a reason this build already understands
  (`idle_timeout`, mapped explicitly in `outcomeFor()`,
  conversation-session.ts:975) and, since the turn would have a `sessionId` by
  then, `reportTurnCapture` and `abandonTurn` both fire normally. Ruled out: no
  code path drops a turn with a live `sessionId` silently.
- **`MAX_UTTERANCE_MS` forced cut (8000ms, use-streaming-translate.ts:51).**
  Forced cuts still send `client.session.end` normally and set `cutForced: true`
  on a turn that DOES reach the server — turn 52 is very likely one such cut
  (its text stops mid-thought: "...rồi có cái gì đâu mà nghĩ"), but a forced cut
  is not itself a loss mechanism; it is orthogonal to the tail turn's
  disappearance, which is the FOLLOWING turn.
- **20s `DRAIN_TIMEOUT_MS` backstop discarding an in-flight turn at teardown.**
  This is the alternative I weighed hardest, since it also produces a silent
  "stopped"-reason drop — except `'stopped'` **is** in `isServerReason`'s
  exclusion list, so that path DOES call `abandonTurn` (it would leave a mark,
  just not a finished turn). More decisively, it requires ~20s between speech
  ending and the recording's stream tracks being stopped, and the measured gap
  between recording-end and `endedAt` is ~0ms, not ~20s. Ruled out by the
  wall-clock arithmetic above.
- **Client's own per-socket ceiling (its 3 in-flight turns never closing) with no
  retry mechanism.** True that `tryStart()` has no timer for this case — only
  `startNextWaiting()`, triggered when one of the client's own turns closes. But
  that failure mode parks the turn in `waiting` _indefinitely_ (until this
  client's own traffic frees a slot, or the 20s drain timeout tears it down via
  `'stopped'`, which — again — is correctly reported). It does not explain a
  turn vanishing in ~3s with zero trace. The `too_many_turns` path is the one
  that both loses the turn silently AND resolves fast enough to match the
  timing evidence.

## What distinguishes the confirmed cause from the alternatives

Only `too_many_turns` retry-exhaustion (a) resolves in a few seconds rather than
20s, matching the ~0ms drain gap, and (b) is excluded from `abandonTurn` by a gap
in `isServerReason()`'s three-item list, matching the complete absence of any
onscreen trace (no live line, no "abandoned" marker, no metrics row). No other
path in `turn-pipeline.ts` or `conversation-session.ts` produces both properties
at once.

## Test coverage

`turn-pipeline.spec.ts:361-374` ("gives up after a bounded number of refusals,
and says so") proves the **pipeline** reports `onTurnClosed(turnId,
'too_many_turns')` after exhaustion — this is the mechanism's foundation and is
correctly tested.

`conversation-session.spec.ts` has **no** test for `isServerReason` or for what
happens above the pipeline when `'too_many_turns'` is the close reason — grepped
for `isServerReason`, `too_many_turns`, `abandonTurn`, `onTurnAbandoned`: zero
matches. The gap that loses the turn is entirely untested.

## Fix shape (not implemented — diagnosis only)

Add `'too_many_turns'` to the exclusion list in `isServerReason()`
(conversation-session.ts:939), the same as `'dropped_pending'`: both are cases
where the pipeline invented the close itself and no real server session ever
existed for the turn's audio to be reasoned about server-side. That routes it
through `abandonTurn()`, which at minimum marks it in the transcript instead of
letting it vanish. A regression test belongs in `conversation-session.spec.ts`:
open a turn, drive the pipeline's own refusal-exhaustion path (or fake it via the
`TurnPipelineHandlers.onTurnClosed` contract), and assert `onTurnAbandoned` fires.

## Unresolved questions

1. Whether this specific conversation's global ceiling was actually saturated by
   _other_ users at 17:51 on 2026-09-16 cannot be confirmed — server logs from
   that day are gone (container restarted 2026-09-18). If reproducing this
   matters, add a log line at the `forget(turn, 'too_many_turns')` give-up site
   (turn-pipeline.ts:464) — it already logs to `onLog`, but nothing persists
   client-side logs anywhere durable (`console.warn` only, per
   `use-streaming-translate.ts:386`).
2. Whether the client's OWN 3-in-flight ceiling was simultaneously near-full
   from this same conversation's tail end (turns 50-52 landing 1s apart) —
   plausible given the timestamps, and would explain why even a modest bump in
   global contention was enough to exhaust 4 retries before a same-client slot
   freed. Not needed to explain the loss, but relevant if tuning ceilings later.

Status: DONE
Summary: The tail turn was opened client-side, refused by the server's ceiling
(most likely the process-wide 6-turn ceiling, not this client's own 3), retried
4 times over ~3s per `MAX_REFUSAL_RETRIES`/`REFUSAL_RETRY_MS`, then given up on
via `TurnPipeline.forget(turn, 'too_many_turns')` — a reason `isServerReason()`
in `conversation-session.ts` wrongly treats as server-confirmed, so
`abandonTurn()` never fires and the turn disappears with no transcript trace,
while its raw audio survives in the separately-captured recording. Confirmed by
matching the ~0ms gap between the recording's own end and the conversation's
saved `endedAt` (rules out the 20s drain-timeout alternative) and by the absence
of any test around `isServerReason`/`too_many_turns` in
`conversation-session.spec.ts`.
Concerns/Blockers: No production log access for the incident window (container
restarted since); root cause is proven by code + timing arithmetic, not by a
captured `too_many_turns` event from that exact night. See Unresolved Questions.
