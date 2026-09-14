---
title: 'Conversation audio recording on R2, with per-utterance timestamps'
description: 'Record each /translate conversation in the browser, store it in R2 under conversations/, and play it back on the history detail screen beside a clickable timestamp gutter.'
status: in-progress
priority: P2
effort: '2-3d'
tags: [audio, storage, r2, history, privacy]
created: 2026-09-14
---

# Conversation audio recording on R2, with per-utterance timestamps

## Overview

A user finishes a conversation, opens it in history, and wants to check whether a bad
line was a bad recognition or a bad translation. Today they cannot: no audio is retained
anywhere, and the transcript carries no times. This delivery adds both — the recording,
and a timestamp per utterance that seeks the player to that moment.

The accepted brainstorm contract is
[`plans/reports/brainstorm-260914-1029-conversation-audio-recording-timestamps.md`](../reports/brainstorm-260914-1029-conversation-audio-recording-timestamps.md).
Its outcome, constraints, non-goals and acceptance criteria are reused here and are not
re-derived. It was produced by a best-of-5 verifier pass; the ranking appendix is in that
report.

**One decision in that contract has since been overridden by the user — see
"User decisions" below. It is the only material difference between the contract and this
plan, and it changes the storage design but nothing else.**

Both halves are cheaper than they look, for different reasons:

- **The timestamps are not a new measurement.** `TurnCapture { openedAt, closedAt }`
  already exists client-side and `display-groups.ts` already trusts `openedAt` to merge
  ceiling-split turns. The schema comment records that these were deliberately not
  persisted. Persisting one is a contract change.
- **The upload needs no presigner, no CSP change and no new package.** `main.ts:27` and
  `narrow-body-limits.ts` register only `json()` parsers and there is no multipart
  middleware anywhere in the API, so an `audio/webm` body is read by **nothing** until
  this feature registers `express.raw` for it.

## User decisions (do not re-litigate)

| Decision                                                              | Consequence                                                                         |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Recording is **ON by default** for every user                         | The landing copy is the privacy notice and must change in the same PR (Phase 6)     |
| Retention is **until the user deletes the conversation**              | No expiry, no quota. Storage grows as fast as people talk (~1.5 MB per 10 min)      |
| Web `/translate` **only**                                             | `apps/extension` and `apps/mobile` are non-goals                                    |
| Click-to-seek **is** wanted                                           | The gutter is a button, not text; this is what selected the winning design          |
| **Safari must work**                                                  | `audio/mp4` is a live branch, not a fallback — recorded, sniffed, served and tested |
| **Same `chatofy` bucket, `conversations/` prefix** — no second bucket | See the accepted exposure below                                                     |

### The accepted exposure, recorded once

The brainstorm contract required a **separate private bucket**, and the codebase says why
in the avatar key builder itself (`apps/api/src/modules/storage/avatar-image.ts:67-74`):

> The `avatars/` prefix is a namespace inside a bucket meant to be shared with other
> features later. It is **NOT an access boundary**: R2 public access is bucket-level and
> its API tokens scope to a bucket, never to a prefix — so anything that must not be
> world-readable belongs in a different bucket, not under a different prefix here.

The user was shown this and the trade-off, and chose the shared bucket anyway to avoid a
second bucket and a token re-scope. **The consequence is that every conversation recording
is world-readable by URL at `${R2_PUBLIC_BASE_URL}/conversations/…`, permanently, with no
authentication, no owner check and no revocation.** That is this plan's largest known
risk and it is a product decision, not an oversight.

Two things follow, and both are in scope here:

1. **The key carries independent entropy**, exactly as `buildAvatarKey` does, so a URL
   cannot be derived from a user id or a conversation id:
   `conversations/{ownerId}/{random16}.{ext}`. Unlike the avatar key this design _does_
   lean on unguessability, which the avatar comment explicitly says its own design does
   not — so the entropy is load-bearing here in a way it is not there.
2. **Playback still goes through the owner-scoped API route**, not the public URL. It
   costs one extra route and keeps the CSP, the web image and the deploy smoke untouched;
   more importantly it is what makes moving to a private bucket later a one-line change
   rather than a rebuild of the whole playback path.

## Goals

| #   | Goal                                                                                                                       | Priority |
| --- | -------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | A finished `/translate` conversation's audio is stored in R2 and nothing else about the conversation changes               | P1       |
| 2   | Every transcript block shows the time it was said, and clicking it seeks the player there                                  | P1       |
| 3   | A conversation with no recording — old, failed, or storage unconfigured — renders exactly as today, never a broken control | P1       |
| 4   | Deleting a conversation deletes its recording, and says so honestly when it cannot                                         | P1       |
| 5   | The landing copy stops claiming audio is never uploaded, in both languages, in the same PR                                 | P1       |
| 6   | Chromium, Firefox and Safari all record and play back                                                                      | P2       |

## Phases

| #   | Phase                                                                                       | Status                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [Phase 1: Measure blob seeking before designing the player](./phase-01-seek-spike.md)       | **NOT RUN** — needs a human at a microphone on three browsers. The player was built to survive either answer: seeking is guarded, and the total comes from the stored `audioDurationMs` rather than from `audio.duration`. |
| 2   | [Phase 2: Contracts, schema, and the offset projection](./phase-02-contracts-and-schema.md) | Completed                                                                                                                                                                                                                  |
| 3   | [Phase 3: API storage and routes](./phase-03-api-storage-and-routes.md)                     | Completed                                                                                                                                                                                                                  |
| 4   | [Phase 4: Client capture and upload](./phase-04-client-capture-and-upload.md)               | Completed                                                                                                                                                                                                                  |
| 5   | [Phase 5: History UI — gutter and player](./phase-05-history-ui.md)                         | Completed                                                                                                                                                                                                                  |
| 6   | [Phase 6: Privacy copy, docs, and verification](./phase-06-copy-docs-verification.md)       | Copy and docs done; the browser matrix is **not run** — same reason as Phase 1.                                                                                                                                            |

Phase 1 is a standalone browser spike with **no repo changes** and it gates Phase 5's
player design — run it first, because its answer decides whether the gutter is a button
or plain text. Phases 2→3→4→5 are a dependency chain. Phase 6 must merge in the **same
PR** as Phases 3–5: the copy amendment is the privacy notice, and `en.ts:446-457` records
the rule that it changes _with_ the behaviour rather than after it.

## Verified constraints (do not re-litigate without new evidence)

- **`app.use('/conversations', …)` is a prefix mount** — proven by
  `@Controller('conversations/:conversationId/minutes')` at `minutes.controller.ts:41`.
  The raw parser is therefore mounted on the exact param path
  `/conversations/:conversationId/audio`, which is legal on Express 5 and isolates it.
- **Both body parsers dispatch on content type.** `narrow-body-limits.ts` and `main.ts:27`
  are `json()`; neither reads an `audio/*` body, so registration order does not matter and
  the 1 MB JSON ceiling is provably untouched. `express` is already a direct dependency
  (`apps/api/package.json:47`), so `raw` adds no package.
- **`TransformInterceptor` wraps every non-`/health` response** in `{success, data, meta}`
  (`transform.interceptor.ts:26-46`). Nest's `instanceof StreamableFile` check runs _after_
  interceptors, on the mapped value, so returning a `StreamableFile` ships a JSON body, not
  audio. The binary GET must use non-passthrough `@Res()`.
- **`<audio src>` cannot authenticate.** `auth.module.ts:113` makes `JwtAuthGuard` the sole
  global `APP_GUARD` and nothing on the conversations controller is `@Public()`. Combined
  with `media-src 'self' blob:` (`next.config.ts:88`), fetch-to-blob is the only
  authenticated read path — and `blob:` is already admitted, so no CSP change.
- **`connect-src 'self' ${api} ${socket}`** (`next.config.ts:85`) forbids a browser fetch
  straight to R2, which is why presigned direct upload was rejected outright.
- **A re-save cannot clobber the audio columns.** `prisma-conversation.store.ts:105-112` is
  an `upsert` whose `update` is `{direction, startedAt, endedAt}` only; turns are
  `deleteMany` + `createMany`. Parent columns survive a rename re-save for free — **and
  that `update` list must stay exactly three fields**, which belongs in a code comment.
- **The offset base is not the recording start.** `use-streaming-translate.ts:383` stamps
  `startedAt` _before_ `session.start()` — before the permission prompt, worklet load and
  socket connect — so `audioOffsetMs` is required or every timestamp is wrong by the same
  unknown constant.
- **The clocks subtract cleanly.** `turn-pipeline.ts:194,250` stamps `openedAt` from
  `Date.now()`; `use-streaming-translate.ts:383` stamps `startedAt` as
  `new Date().toISOString()` in the same tab.
- **`/history/[conversationId]` has spent both design budgets exactly** —
  `accent-budget-app.spec.tsx:465-492` pins both rows at `filled: 1, surfaces: 2`,
  `KNOWN_VIOLATIONS` is `{}` and enforced in both directions. The two surfaces are the
  transcript and minutes `Card`s; the one accent is Generate minutes. `accent-count.ts:51`
  counts `bg-primary` on `button, a, [role="button"]` only, so a `Slider`'s filled range
  (a `div`) is free; `surface-count.ts:26-33` counts `data-slot="card"` or
  `shadow-elev-md|lg`.
- **Server-side audio cannot be used.** `capture-pump.ts` drops audio outside a turn and
  half-duplex ignores the microphone while our own translation sounds, so server buffers
  are a gappy sequence of utterances whose media time does not match wall clock. No
  `ffmpeg` in any Node package.
- **Only utterance-level timing exists.** The sherpa-onnx sidecars request and return no
  token timings.
- **`packages/realtime-client` is shared with the extension**, but the extension calls
  neither `toConversationTurns` nor `saveConversation`, so the projection signature can
  change without touching it.
- **Workspace filter names are `api`, `web`, `types`, `realtime-client`** — not
  `@chatofy/*`. A command written the other way does not run.

## Non-goals

Carried from the contract: the extension and mobile surfaces; word-level timings and
karaoke highlighting; any storage quota or usage metering; retention policy or auto-expiry;
resumable or crash-proof upload (the recording inherits the transcript save's existing
loss profile on a hard tab close); searching or generating minutes from audio; a recording
marker on the history list card (`conversationSummarySchema` stays untouched).

Added here: **no CSP, `R2_PUBLIC_BASE_URL`, or web-image-rebuild change**, and therefore no
third case in the deploy smoke's served-header assertions. A diff touching
`.github/workflows/deploy.yml:218-250` is evidence the design drifted.

## Success criteria

- [ ] A finished conversation on `/translate` produces an object under `conversations/` in R2 and an `audioKey` on the row
- [ ] Every stored block carries `offsetMs`; the gutter renders `m:ss` and clicking it seeks the player within ±1 s of the utterance
- [ ] A conversation with no recording renders today's layout with no gutter and no bar
- [ ] `DELETE /conversations/:id` removes the object before the row; a storage failure leaves both and answers 409
- [ ] `en.ts` no longer contains "never uploaded" and `vi.ts` no longer contains "không bao giờ được tải lên"
- [ ] `accent-budget-app.spec.tsx` passes with `KNOWN_VIOLATIONS` still `{}` and two new rows at `filled: 1, surfaces: 2`
- [ ] The existing 413 case at `conversations.db-e2e-spec.ts:247` still passes unchanged
- [ ] `.github/workflows/deploy.yml:218-250` is unmodified
- [ ] `pnpm lint && pnpm typecheck && pnpm build && pnpm knip` green
- [ ] Recorded and played back on Chromium, Firefox and Safari

## What shipped differently from this plan, and why

Four deviations, each found by something that ran rather than by re-reading the plan:

1. **`offsetMs` is OPTIONAL on the write contract, not required-nullable.** As first
   written it was required, which meant a browser holding the previous bundle would take a
   400 on every save and lose the conversation. The db-e2e suite caught it. It now defaults
   to null.
2. **The two R2 clients are NOT one extracted helper**, which step 3 of Phase 3 asked for.
   The avatar client is bounded at `requestTimeout: 5000` for the login path, on the stated
   reasoning that "the caller that most needs an answer is the one that cares least about
   the result". None of that transfers to a 32 MB upload: sharing it would have failed every
   long conversation while short ones worked. The recording client uses 120s, and
   `r2-conversation-audio-storage.spec.ts` asserts the difference so nobody merges them.
3. **`packages/types` gained a vitest harness.** Phase 2's criterion 1 was
   `pnpm --filter types test`, and the package had no test script at all. Added following the
   `packages/ai-providers` precedent from the previous delivery.
4. **415 had to be added to the swagger error map** before the app would boot —
   `ApiErrorResponses` throws on an undocumented status. Found by the e2e run.

## Code review, and what it caught

A `code-reviewer` pass on the finished diff found a **blocker that no test in this repo
could see**, plus six smaller items. All are fixed.

**The blocker: every recording was silently discarded on the normal End path.**
`ConversationSession.finish()` stops the microphone tracks _first_, which per the
MediaStream Recording spec ends the recorder — it flushes, fires `stop`, goes inactive —
and only _then_ does the session drain for seconds before emitting `idle`. The recording
hook ran at `idle`, read `state === 'inactive'` as "nothing was recorded", and returned no
blob. Nothing uploaded, no failure alert, nothing in the bucket. Invisible to every gate:
happy-dom has no `MediaRecorder`, and the API tests sit on the far side of an upload that
never happened. The recorder now assembles its blob in its own `stop` handler, and
`use-conversation-recording.spec.tsx` reproduces the real ordering — verified to fail on
the old code and pass on the new.

The same defect made `durationMs` include the drain, which would have put the scrubber's
maximum past the end of the audio. It is now stamped in the stop handler.

Also fixed: an unexpected `Content-Type` produced a 500 rather than 415 (body-parser leaves
`req.body` undefined, and the sniff dereferenced it); an upload racing a delete from another
tab could leave a world-readable object with no row and no future delete — real exposure
beyond the accepted decision, now cleaned up on the 404 path; the player kept one
conversation's audio when pointed at another id; dragging the scrubber forced playback; and
one accent-spec row asserted nothing, which is now a real pressed state proven by a
`role="status"` the failure announces.

What the review found clean, under adversarial reading: owner scoping on every audio path,
the parser split (confirmed empirically that the 1 MB JSON ceiling still binds on both
paths), key entropy and non-derivability, the offset arithmetic, and the once-per-
conversation upload guard.

## Still outstanding

- **Phase 1's spike and Phase 6's browser matrix.** Neither can be automated: happy-dom has
  no `MediaRecorder`, and no gate in this repo can see whether a gutter time lands within
  ±1 s of the utterance it labels. Chromium's `MediaRecorder` writes no Duration into the
  WebM header, so whether `currentTime` assignment works on a `blob:` URL is genuinely
  unverified; if it does not, the gutter degrades to plain text and nothing else changes.
- **Safari.** `audio/mp4` is recorded, sniffed, stored and served, and the e2e covers the
  MP4 path — but no real Safari has run this.
- **`throwOnRequestTimeout`.** Open question 3 below is still open: the verifier reported
  that a bare `requestTimeout` only warns in the installed smithy version. Not independently
  confirmed here, because this repo's `scout-block` hook blocks reads under `node_modules`.

## Open questions

1. **Is a 32 MB cap (~3h06m at 24 kbps) the right ceiling**, given `MAX_DURATION_MS`
   permits 24 hours? A conversation past the cap gets its transcript stored and its
   recording refused with a 413. Settle before Phase 2 fixes the constant.
2. **Does the existing R2 token already permit writes under an arbitrary prefix?** It is
   scoped to the `chatofy` bucket, and prefixes are not an access boundary, so it should —
   but this is worth confirming against the real token before Phase 3 rather than
   discovering it at deploy.
3. **`throwOnRequestTimeout`** — the verifier reported that in the installed
   `@smithy/node-http-handler` 4.11.3 a bare `requestTimeout` only logs a warning and the
   request keeps running. I could not confirm this independently because this repo's
   `scout-block` hook blocks reads under `node_modules` and I did not work around it.
   Confirm in Phase 3; if true it is also a latent defect in the existing avatar client at
   `r2-avatar-storage.ts:66`, which `r2-avatar-storage.spec.ts:59-62` cannot see because it
   asserts only `requestTimeout > 0`. That fix is a separate follow-up, not this plan.
