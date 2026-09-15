---
phase: 4
title: 'Phase 4: Client capture and upload'
status: completed
priority: P1
effort: '5-6h'
dependencies: [3]
---

# Phase 4: Client capture and upload

## Overview

Record the conversation from the stream the app already opens, and send it once the
transcript row exists.

The tap is small because the seam is already there: `apps/web` supplies `openMicrophone`
to `ConversationSession` as a dependency (`use-streaming-translate.ts:246`), so recording
is a wrapper around that one function — the stream is handed back to the session unchanged
and a `MediaRecorder` starts on the same tracks. `ConversationSession` learns nothing about
recording, which is what keeps `packages/realtime-client` — shared with the extension —
out of this phase entirely.

What is recorded is the **processed** signal: `CONVERSATION_AUDIO` asks for
`echoCancellation`, `noiseSuppression` and `autoGainControl`
(`apps/web/src/lib/open-microphone.ts:60-64`). That is exactly what the recognizer hears,
which is what makes the recording answer the question the user asked it to answer.

## Requirements

Functional:

- Record continuously for the life of the conversation and resolve a Blob when it ends.
- Report the recorder's own start instant, so `audioOffsetMs` is real rather than assumed.
- Upload **once per `conversationId`**, and only after the transcript save has succeeded.
- Report an upload failure to the user with a retry when retrying can work.

Non-functional:

- **Record straight through `pause()`/`resume()`.** A paused recorder desynchronises every
  offset from the media, which is the one thing the gutter depends on. The session releases
  nothing on pause (`conversation-session.ts:349-364`), so the stream stays live.
- The recording must never be able to damage the transcript. The two writes are independent
  requests and the audio one runs **second**.
- No change to `packages/realtime-client`'s audio path.

## Files

Owned by this phase:

- `apps/web/src/hooks/use-conversation-recording.ts` (new)
- `apps/web/src/hooks/use-conversation-audio-upload.ts` (new)
- `apps/web/src/hooks/use-streaming-translate.ts` — the `openMicrophone` dep at line 246
- `apps/web/src/components/translate/cascade-panel.tsx` — wire the projection and upload
- `apps/web/src/clients/api-client.ts` — two byte-carrying calls
- `apps/web/src/lib/api-failure.ts` (new) — `classify`, lifted from `use-conversation-save.ts`
- `apps/web/src/hooks/use-conversation-save.ts` — import `classify` instead of defining it
- Specs beside each

## Steps

1. **`use-conversation-recording.ts`.** Given the `MediaStream`, pick the first supported
   type from a candidate list ordered by Phase 1's findings — `audio/webm;codecs=opus`,
   `audio/webm`, `audio/mp4` — start with `audioBitsPerSecond: 24_000`, collect
   `dataavailable` chunks, and resolve `{ blob, recordingStartedAtMs, recordingStoppedAtMs }`
   when the session's `finish()` stops the tracks
   (`conversation-session.ts:432-436`).

   **Stamp `recordingStartedAtMs` from `Date.now()` even when `MediaRecorder` construction
   throws**, so a browser with no supported container still yields correct timestamps and
   simply no audio. Return no blob in that case; the transcript half must not depend on the
   recording half.

2. **The mic wrapper.** `use-streaming-translate.ts:246` becomes a function that resolves
   the stream, hands it to the recording hook, and returns it unchanged. One call site.

3. **Projection wiring.** In `cascade-panel.tsx`, call
   `toConversationTurns(state, Date.parse(conversation.startedAt))` so every block carries
   `offsetMs`.

4. **`use-conversation-audio-upload.ts`.** Fires once per `conversationId`, and only when
   `save.saved` is true — the row must exist before anything can point at it, and a rename
   re-save must never re-upload. Computes:
   - `offsetMs = recordingStartedAtMs − Date.parse(startedAt)`, clamped at 0
   - `durationMs = recordingStoppedAtMs − recordingStartedAtMs`

   **Refuse locally when `blob.size > MAX_CONVERSATION_AUDIO_BYTES`** rather than spending
   the upload to earn a 413.

5. **`api-failure.ts`.** Lift `classify` out of `use-conversation-save.ts` so both hooks
   share one `'retryable' | 'terminal'` split. 409, 413 and 415 are terminal; everything
   else retryable, matching the existing rule that an unrecognised failure defaults to
   retryable rather than abandoning work a blip could have saved.

6. **`api-client.ts`.** `uploadConversationAudio(id, blob, offsetMs, durationMs)` and
   `fetchConversationAudio(id): Promise<Blob>`. Both are **authenticated raw** calls, not
   `authedFetch`: `ApiRequestOptions.body` is `string` and every shared-client response is
   zod-validated against the success envelope, so bytes fit neither direction, and widening
   the shared client would change a package `apps/mobile` consumes for a web-only feature.

   **Resolve the bearer the way `authedFetch` does and reuse `recoverFromUnauthorized` for
   one retry on 401.** Without it a stale token makes the player fail on first press after
   a long read — the most likely moment someone opens an old conversation.

7. **Failure UI.** Reuse the existing `Alert variant="live"` region with an **outline**
   Retry. A terminal failure states what happened and offers no retry, because offering one
   forever is a lie — the same reasoning `use-conversation-save.ts` already documents.

## Validation

```bash
pnpm --filter web test
pnpm typecheck
```

New test cases:

- The recorder stamps `recordingStartedAtMs` even when `MediaRecorder` construction throws,
  and yields no blob.
- Upload fires exactly once per `conversationId`, and not at all until `save.saved`.
- A transcript edit after the conversation ends re-saves the transcript and does **not**
  re-upload.
- A blob over the cap is refused locally, with no request made.
- `offsetMs` and `durationMs` are computed from the recorder's own instants, not from
  `startedAt`/`endedAt`.
- A 401 on fetch triggers exactly one recovery attempt.
- Terminal versus retryable classification for 409/413/415 against 500/503.

**happy-dom has no `MediaRecorder`**, so the recorder specs need a hand-written fake —
`fake-audio-context.ts` is the precedent in this repo. It does have `URL.createObjectURL`
and a working `HTMLAudioElement`, so Phase 5's player specs need no shim.

## Risk and rollback

**Risk: the Blob sits in tab memory for the whole conversation.** ~10.8 MB/hour at 24 kbps,
bounded by the 32 MB cap. A tab crash loses the recording — and the transcript save already
accepts exactly that loss profile on a hard tab close ("This is accepted, not overlooked",
`use-conversation-save.ts:94-102`). Making the audio more durable than the transcript it
belongs to would be an odd place to spend complexity.

**Risk: a deployment with R2 unconfigured still records and buffers.** The tab holds the
blob until the upload answers 409 and discards it — bounded by the same cap, never leaving
the machine. Avoidable only with a capability endpoint, which is more surface than the
waste is worth until someone measures it hurting.

**Risk: recording through pause surprises the user.** A person who presses pause may
believe the microphone is off; it is not, because stopping the recorder would break every
subsequent timestamp. Phase 6's copy must say so.

**Rollback:** revert the `openMicrophone` wrapper to the plain call. Nothing records,
nothing uploads, and the transcript path is byte-identical to today.
