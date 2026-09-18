# Phase 2 — The startup window that loses the opening

## Context

`ConversationSession.start()` awaits `openMicrophone()`, then
`audioWorklet.addModule()`, then `socket.connect()`, and only then connects the
capture pump. `apps/web/src/hooks/use-streaming-translate.ts:288` attaches the
`MediaRecorder` inside `openMicrophone`, so recording begins at the first await
and capture at the last. Speech in between is recorded and never transcribed.

Measured on conversation `f35c2816`: `audioOffsetMs = 171`, first speech burst at
media 0.00–1.70 s (RMS peaking 0.17, "Alo anh em"), first stored turn at media
2.672 s. At least 1.70 s of speech lost, at most 2.67 s.

The speech gate is not involved: it starts at `noiseFloor = MIN_NOISE_FLOOR`
(0.004) and only adapts on silence, so that burst would have opened a turn had
samples been reaching it.

## Requirements

- What the recording contains and what the transcript covers agree at the start.
- The fix lives where the ordering problem is. `@chatofy/realtime-client` is
  shared with the extension, so the web app must not become a special case.
- `audioOffsetMs` keeps meaning "ms between `startedAt` and the first recorded
  sample" — whatever the fix does to when recording begins, the stored offset
  must still describe the audio that was stored.

## Files

- `packages/realtime-client/src/conversation/conversation-session.ts`
- `apps/web/src/hooks/use-conversation-recording.ts`
- `apps/web/src/hooks/use-streaming-translate.ts`
- the matching `.spec.ts` beside each

## What was done

In two passes, because the first closed one gap and opened a smaller one.

**First**, `start()` was reordered to open the microphone LAST — context and
worklet, then the socket, then `openMicrophone()`, then the synchronous block
that wires the source to the worklet node. That closed the original defect: the
recorder could no longer start before capture existed. But it meant capture began
after the handshake too, so anything said between pressing Start and the socket
coming up reached neither the recording nor the transcript.

**Second**, the worklet is wired to the microphone the instant it resolves —
before the socket is even created — and the blocks it posts go into a bounded
buffer (`MAX_PREBUFFER_MS`, 20 s, oldest dropped first, the same magnitude and
the same reasoning as the pipeline's own `MAX_PENDING_MS`). When the pipeline and
pump exist, the buffer is replayed into the pump in order and the handler is
swapped to the live one, both in one synchronous stretch so no block can land
between them and be skipped or duplicated.

The order is now: context and worklet, microphone, wire and buffer, socket,
pipeline, drain, swap. The fix lives in the one place the web app and the
extension share.

Checked before committing to it: none of the three earlier steps reads
`local.stream`; `releaseResources` acts only on the fields that are set, so a
microphone refused after the context and socket exist still tears all three down;
and `getUserMedia()` requires no transient user activation (unlike
`getDisplayMedia()`), so moving it behind several awaits carries no
browser-refusal risk. `audioOffsetMs` keeps its meaning — it is stamped when
`openMicrophone()` resolves, wherever in `start()` that happens.

## Validation

- An ordering test asserts capture is wired before `socket.connect` is even
  called, and that the microphone still opens only after the worklet module has
  loaded.
- A second test proves a block delivered BEFORE the socket connects still reaches
  the pipeline, in order, once the session is live. It fails against the previous
  ordering.
- The teardown-checkpoint and stale-start tests were rewritten: they encoded the
  old order, so leaving them would have meant testing the defect.
- `pnpm --filter @chatofy/realtime-client test` (357 passed) and
  `pnpm --filter web test` (962 passed); typecheck clean.

## Risk and rollback

A buffer that is fed in too late arrives after the gate has already decided the
room is silent. Rollback is the ordering as it stands today.
