---
phase: 5
title: 'Phase 5: Suggestion engine in the API'
status: pending
priority: P2
effort: '1-2d'
dependencies: [1, 4]
---

# Phase 5: Suggestion engine in the API

## Overview

Carry each turn's embedding to the browser, and let the client propose a speaker from it. Built
behind a flag that is **off**; Phase 6 turns it on.

## Requirements

**Functional**

- [ ] A client opts in per session; the API embeds only for turns that asked
- [ ] The API requests an embedding per turn, concurrent with transcription
- [ ] The vector reaches the client on a distinct server event
- [ ] The client scores it against per-speaker centroids and may attach a `suggested` attribution
- [ ] Only a `confirmed` attribution updates a centroid
- [ ] A score inside the dead zone yields no suggestion at all
- [ ] Off by default; when off, no `/embed` call is made and no event is sent

**Non-functional**

- [ ] End-to-end turn latency unchanged when off, and ≈ unchanged when on
- [ ] `speakerRoleSchema` untouched
- [ ] No voiceprint persisted anywhere, server or client

## Architecture

**Centroids live in the browser, not in the API.** The prior contract put clustering state in the
Node API per connection, and that was right when the server decided the label. It no longer does.
The roster is client state (Phase 1) and confirmations are client actions (Phase 2), so centroids
built from confirmed turns belong where their inputs already are. Splitting them would mean a new
client→server event carrying every confirmation upstream just so the server could rebuild state the
client already holds.

It is also strictly better for the constraint this plan inherited: the voiceprint exists in one tab
and dies with it. The API stays as stateless about speakers as the sidecar does. A 192-float vector
per turn is under a kilobyte on a socket already carrying base64 audio.

**A distinct server event, not a field on the segment.** `transcriptSegmentSchema` is the canonical
segment shape and is consumed by the extension and mobile. Hanging a raw biometric vector on it
would push it into surfaces that have no use for it.

**The client opts in per session, and that is not optional politeness.** `serverEventSchema` is a
strict discriminated union the client `safeParse`s rather than casts, and an unparseable event goes
to `onError` — which on web is `setError` **plus** `recovery.handleConnectionFailure()`, an auth
probe, once per turn. And `ws-events.ts` states the governing fact directly: _"`apps/api` and
`apps/web` do not deploy atomically, so a tab loaded before a deploy is still sending the old
shape."_ A tab open across the deploy that adds this event has the old schema, so sending it
unbidden would give that tab an error banner and an auth probe on every turn. Adding the member
early does not fix this; nothing guarantees no tab predates the flip.

So `sessionOptionsSchema` gains an optional boolean, following `voiceGender`'s existing pattern —
_"defaulted rather than required, so a client may omit it entirely"_. An old client never sends it
and never receives the event. This also stops `apps/extension` paying the sidecar's embedding cost
for turns it would discard, which matters because meeting capture is continuous and generates far
more turns than the web page does. And it gives Phase 6 a client-side off switch beside the server
one.

**Concurrency is the whole latency argument.** `transcribeAndTranslate` awaits the transcript, then
translates. The `/embed` call must be started **beside** `transcribe`, not after it, and awaited only
where the segment is assembled. Started at the wrong point it becomes serial and the measured
free-ride disappears.

**Event payload.** `{ type: 'server.turn.embedding', sessionId, vector, dim, audioMs }`.

`audioMs` is not decoration: the centroid is a **duration-weighted** running mean, and
`TranscriptSegment` carries no duration — the client cannot reconstruct one from what it already
has. The API can, because it holds the bytes. Without it the port of `online.py` silently becomes an
unweighted mean, which is a different algorithm from the one that was measured.

`sessionId` is the key, matching Phase 1. Not `segment.id`, and not the client's `turnId`.

**Thresholds.** `tau_assign` 0.350, `tau_new` 0.150, from the calibrated run. Between them is a dead
zone that produces **no suggestion** — not a low-confidence guess. That is the point of the dead
zone, and the measurement behind it is blunt: at maximum openness an unenrolled person's turns are
still taken by someone else more than half the time while enrolled accuracy falls 11 points. There
is no operating point that serves both, so the dead zone stays wide and silence is the correct
output.

**Both threshold values are provisional until Phase 6.** They were calibrated on audio that never
passed through the browser's DSP. They are named constants in one place, with a comment saying which
channel they came from.

**A suggestion never seeds a centroid.** Enforced by the `origin` union from Phase 1: the centroid
update reads `confirmed` only. This is the rule that keeps the design from degenerating — one wrong
suggestion that seeds its own centroid makes the next suggestion likelier to be wrong the same way.

## Related Code Files

- Modify: `packages/types/src/events/ws-events.ts` — `server.turn.embedding`, and the opt-in on `sessionOptionsSchema`
- Modify: `apps/api/src/modules/translate/services/pipeline-translator.service.ts` — concurrent embed
- Modify: `apps/api/src/modules/translate/session/turn-session.ts` — carry the vector to emit time
- Modify: `apps/api/src/modules/translate/translate.gateway.ts` — emit the event
- Create: `packages/ai-providers/src/interfaces/speaker-embedding-provider.ts`
- Create: `packages/ai-providers/src/providers/local-speech/local-speech-embedding-provider.ts`
- Modify: `apps/api/src/modules/translate/providers/register-default-providers.ts`
- Create: `packages/realtime-client/src/state/speaker-centroids.ts` — scoring + centroid updates
- Create: `packages/realtime-client/src/state/speaker-centroids.spec.ts`
- Modify: `packages/realtime-client/src/state/turn-keyed-transcript.ts` — handle the new event
- Modify: `apps/api/src/config/env.schema.ts` — the flag
- Read (do not modify): `benchmarks/speaker-id/speaker_bench/online.py` — the measured algorithm

## Implementation Steps

1. Add the flag to the API env schema, default off. It is the server-side master gate; the per-session
   opt-in is the client-side one, and both must be on for anything to happen.
2. Add `server.turn.embedding` and the optional opt-in to the shared contract; rebuild dependents.
3. Write the embedding provider, mirroring `LocalSpeechSttProvider`'s error classes and URL handling
   so a sidecar failure is reported the same way as an STT failure.
4. In `transcribeAndTranslate`, start the embed call beside `transcribe` and await it only at
   segment assembly. **A failed embedding must never fail a turn** — log it, emit no event, and let
   the turn deliver its translation. Attribution is an enhancement on a translator.
5. Emit the event from the gateway alongside the final segment — only when the turn opted in.
6. Write `speaker-centroids.ts`: cosine against each centroid, dual threshold, dead zone, and a
   duration-weighted running mean updated only from `confirmed` turns. Port the shape from
   `online.py`, which has 21 tests and a mutation check behind it.
7. Wire the event into the reducer: score, and attach a `suggested` attribution only above
   `tau_assign` on a turn nobody has confirmed. A suggestion must never overwrite a confirmation.
8. Specs: a dead-zone score yields no suggestion; a suggestion does not move a centroid; a
   confirmation does; a suggestion arriving after a confirmation is ignored; a failed embed leaves
   the turn translated and unattributed.
9. Measure end-to-end turn latency on the prod container with the flag on and off, and record both.
10. Verify a session that does not opt in makes no `/embed` call at all.

## Success Criteria

- [ ] With the flag off, or with a client that did not opt in: no `/embed` call, no event,
      byte-identical behaviour to Phase 3
- [ ] The event carries `audioMs`, and the centroid mean is duration-weighted by it
- [ ] With it on: turns carry suggestions, and dead-zone turns carry none
- [ ] A suggestion never updates a centroid; a confirmation always does
- [ ] A sidecar failure yields a translated, unattributed turn — never a failed turn
- [ ] End-to-end latency delta ≈ 0, measured on the prod container, number recorded in the plan
- [ ] Gemini requests per turn unchanged
- [ ] `speakerRoleSchema` unchanged; `apps/extension` and `apps/mobile` build with no source edit
- [ ] Full workspace test, lint, typecheck pass

## Risk Assessment

- **The embed call ends up serial.** The single most likely defect here, and it is invisible:
  everything works, only slower. Signal: latency with the flag on exceeds flag-off by more than the
  measured extractor cost. Response: the await must be at segment assembly, not at the call site.
  Test it structurally, not by the clock: mock both providers with deferred promises and assert the
  embed provider was called before the transcribe promise resolves. A wall-clock assertion in CI
  flakes, and a flaky guard gets deleted — which is how this defect would ship anyway.
- **A suggestion silently overwrites a confirmation.** Events and taps race — someone corrects turn
  N while turn N's embedding is still in flight. Signal: the interleaving spec shows a confirmed
  attribution reverting. Response: confirmations win unconditionally, and the reducer enforces it
  rather than the component.
- **Thresholds get treated as settled.** They will look like ordinary constants six weeks from now.
  Signal: someone tunes them against a hunch, or ships them without Phase 6. Response: they are
  named in one place with the channel they came from written next to them, and Phase 6 is what
  authorises them.
- **A vector on the wire looks like a leak.** It is biometric-derived data crossing a socket that
  already carries the audio it came from, to a client that will hold it in memory and drop it. But
  it deserves an explicit note in the contract rather than arriving unremarked, because the next
  person to add persistence anywhere near this path needs to find that decision written down.
- **`server.turn.embedding` reaches a client built before it existed.** Not hypothetical: the
  contract file records that api and web do not deploy atomically. Signal: `safeParse` failures and
  repeated auth probes from a tab that was open across the deploy. Response: the per-session opt-in
  above — a client that cannot parse the event is a client that never asked for it. This is the
  reason the opt-in exists; do not simplify it away as redundant with the env flag.
