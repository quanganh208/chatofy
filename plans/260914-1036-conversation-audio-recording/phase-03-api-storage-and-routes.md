---
phase: 3
title: 'Phase 3: API storage and routes'
status: completed
priority: P1
effort: '6-8h'
dependencies: [2]
---

# Phase 3: API storage and routes

## Overview

Give the API a way to take bytes it currently cannot take, put them in R2, hand them back
to their owner, and delete them with the conversation.

The transport works because of a fact worth stating before the design rests on it:
`main.ts:27` and `narrow-body-limits.ts` register only `json()` parsers, and there is no
multipart middleware in `apps/api/package.json`. So an `audio/webm` body is currently read
by **nothing at all** — `req.body` is `undefined` — and the 1 MB `/conversations` ceiling
provably does not apply to it. This phase registers the parser that reads it.

## Requirements

Functional:

- A raw body parser mounted on the exact audio path, with its own 32 MB ceiling.
- `ConversationAudioStorage` — a seam mirroring `AvatarStorage`, with an R2 implementation
  and a disabled one, bound once at module construction.
- `PUT /conversations/:conversationId/audio` stores the object and writes the columns.
- `GET /conversations/:conversationId/audio` streams the bytes back to their owner.
- `DELETE /conversations/:conversationId` deletes the object **before** the row.

Non-functional:

- The 1 MB JSON ceiling must remain exactly as strict as it is today, proven by the
  existing e2e case rather than asserted.
- A deployment with R2 unconfigured must still boot, with the routes answering 409 —
  the `DisabledAvatarStorage` posture, not a crash and not a silent success.
- Deletion is **not** best-effort. A delete that quietly does nothing leaves a recording
  stored after its owner asked for it to be removed, and the owner was told it succeeded.
- The object key must carry independent entropy — see the plan's "accepted exposure".

## Files

Owned by this phase:

- `apps/api/src/common/middleware/narrow-body-limits.ts` — one `raw` mount
- `apps/api/src/modules/storage/interfaces/conversation-audio-storage.interface.ts`
- `apps/api/src/modules/storage/conversation-audio.ts`
- `apps/api/src/modules/storage/r2-conversation-audio-storage.ts`
- `apps/api/src/modules/storage/disabled-conversation-audio-storage.ts`
- `apps/api/src/modules/storage/r2-client.ts` — extracted shared `S3Client` construction
- `apps/api/src/modules/storage/storage.module.ts`
- `apps/api/src/modules/conversations/conversations.controller.ts`
- `apps/api/src/modules/conversations/conversations.service.ts`
- `apps/api/src/modules/conversations/stores/prisma-conversation.store.ts`
- `apps/api/src/modules/conversations/interfaces/conversation-store.interface.ts`
- New specs beside each, plus `apps/api/test/conversations.db-e2e-spec.ts` extended

## Steps

1. **The raw parser**, in the file that already owns per-path ceilings:

   ```ts
   app.use(
     '/conversations/:conversationId/audio',
     raw({ type: ['audio/webm', 'audio/mp4'], limit: '32mb' }),
   );
   ```

   `raw` is `express`'s own — `express ^5.2.1` is already a direct dependency
   (`apps/api/package.json:47`), so this adds no package. The exact param path isolates it
   from `PUT /conversations/:id`. Registration order does not matter because body-parser
   dispatches on content type, but the comment must say so, because the file's existing
   comment says "whichever runs FIRST decides the ceiling" and a reader will otherwise
   assume this widened the JSON limit. It 413s an oversized body **before the route runs**,
   which is the same guarantee the existing JSON case asserts.

   `registerNarrowBodyLimits` is called from both `main.ts:23` and the e2e harness, so the
   new parser is exercised by the suite rather than being a line no test executes.

2. **Storage seam.** `ConversationAudioStorage { readonly enabled: boolean; put(key, bytes, contentType); get(key): Promise<{ body: Readable; contentType: string; contentLength: number } | null>; delete(key) }`.

   A separate interface rather than a `get` bolted onto `AvatarStorage`: avatars are never
   read back by the API and audio never needs cache-control or a content hash, so one
   shared interface would leave dead code on the login path.

3. **`r2-client.ts`.** Extract the `S3Client` construction currently inline in
   `R2AvatarStorage` so both share one bounded posture. **Pass
   `throwOnRequestTimeout: true`** alongside `requestTimeout` — see open question 3 in
   `plan.md`; confirm the behaviour first, and if confirmed, note in the commit that the
   avatar client has the same latent defect and is a separate follow-up.

4. **`conversation-audio.ts`** holds:
   - `MAX_CONVERSATION_AUDIO_BYTES` (re-exported from the contract constant, not redefined)
   - `sniffConversationAudio(bytes)` — EBML `1A 45 DF A3` → `audio/webm`; `ftyp` at byte 4
     → `audio/mp4`. Mirrors `sniffAvatarImage`, and exists for the same reason: the
     client's declared content type is a claim. **The sniffed type, never the header, is
     what goes to R2 as `ContentType`.**
   - `buildConversationAudioKey(ownerId, type)` → `conversations/{ownerId}/{random16}.{ext}`
     using `randomBytes(8).toString('hex')`, exactly as `buildAvatarKey` does. The docblock
     must state the difference from the avatar case plainly: `buildAvatarKey`'s comment
     says "nothing in this design LEANS on unguessability — the bucket is public-read by
     product intent", and **this design does lean on it**, because the same public bucket
     now holds conversation audio by user decision. No conversation id in the key: it
     appears in the URL bar and in browser history.

5. **Idempotent retry.** The key is random, so a retried upload must not orphan the first
   object. The service reads the row's existing `audioKey` first and **reuses it** when
   present, minting a new key only when the column is null.

6. **Module wiring.** `storage.module.ts` binds `CONVERSATION_AUDIO_STORAGE` from the
   existing `getR2Config` — **no new env var**, because the bucket is `R2_BUCKET`, shared
   with avatars by user decision. Export it alongside `AVATAR_STORAGE` so nothing above the
   module branches on whether R2 is configured.

7. **Routes**, both on the existing controller so `JwtAuthGuard` and the owner-scoping
   discipline are inherited rather than re-implemented:

   - `@Put(':conversationId/audio')`, `@HttpCode(204)`,
     `@Throttle({ default: { limit: 6, ttl: 60_000 } })`. Takes the `Buffer` and validated
     `?offsetMs=&durationMs=`; sniffs (**415** on failure, **400** on an empty body); puts
     the object; writes `audioKey`/`audioOffsetMs`/`audioDurationMs` on the owner-scoped
     row. **404** for a foreign id, identically to an absent one. **409** when storage is
     disabled or unreachable. **413** comes from the parser. The throttle is 6/min rather
     than the save's 30 because the memory bound is 32 MB × in-flight — the same shape as
     `turn-concurrency.ts`'s `MAX_TURN_BYTES × concurrency`, and the docblock should say so.

   - `@Get(':conversationId/audio')` — **non-passthrough `@Res()`**, and the docblock must
     record why: `TransformInterceptor` (`transform.interceptor.ts:26-46`) wraps every
     non-`/health` response in `{success, data, meta}`, and Nest's `instanceof StreamableFile`
     check runs _after_ interceptors on the mapped value — so returning a `StreamableFile`
     ships a JSON body, not audio. Sets `Content-Type` from the stored object,
     `Cache-Control: private, no-store`, and pipes the R2 body. 404 for a foreign id or a
     row with no `audioKey`; 409 when disabled.

   Route ordering is unambiguous: `:conversationId/audio` and `:conversationId` differ in
   depth.

8. **Store and service.** `ConversationStore` gains
   `findAudioKey(ownerId, conversationId): Promise<string | null>` and
   `setAudio(ownerId, conversationId, key, offsetMs, durationMs): Promise<boolean>` —
   boolean so a foreign id answers 404 exactly like an absent one, matching
   `conversations.service.ts:56-60`. `save`'s `createMany` gains `offsetMs`; `toTurn`
   returns it; `get` selects the three audio columns and maps them to
   `hasRecording: audioKey !== null` plus the two numbers.

   Add a comment on the upsert at `prisma-conversation.store.ts:110` stating that
   `update: parent` must stay exactly `{direction, startedAt, endedAt}` — the audio
   columns' survival across a rename re-save depends on it, and that is invisible from the
   line itself.

   `ConversationsService.remove` becomes: read the key → if present, `audio.delete(key)` →
   **only then** `store.remove`. That order is the avatar route's and it is the one that
   cannot orphan an object nobody can reach again. The cost is one extra SELECT per delete.

## Validation

```bash
pnpm --filter api test
pnpm --filter api test:e2e
```

New unit specs:

- `conversation-audio.spec.ts` — sniff accepts EBML and `ftyp`; refuses a JSON body, a
  `RIFF/WAVE` body, an empty buffer, and anything over the cap. Key format matches
  `conversations/{ownerId}/{32 hex}.{ext}` and two calls never collide.
- `r2-conversation-audio-storage.spec.ts` — mirrors `r2-avatar-storage.spec.ts`:
  put/get/delete, `NoSuchKey` and 404 on delete resolve, every other failure rejects.

New e2e cases in `conversations.db-e2e-spec.ts`:

- Upload returns 204 and sets `audioKey`; a second upload to the same conversation reuses
  the same key rather than minting a second object.
- A foreign id returns 404 identically to an absent one.
- A body over the cap returns **413 before the route runs**.
- A non-WebM/MP4 body returns 415; an empty body returns 400.
- With storage unconfigured, 409 and the row is untouched.
- `GET …/audio` streams the bytes with **no success envelope** — assert the raw body has
  no `success` key, beside `apps/api/test/response-envelope.e2e-spec.ts`.
- `DELETE /conversations/:id` with a recording deletes the object **before** the row; a
  storage failure leaves **both** in place and answers 409.

**Two regression gates that must both hold:**

- The existing 413 case at `conversations.db-e2e-spec.ts:247` passes **unchanged** — that
  is the evidence the raw parser did not widen the JSON ceiling.
- The inverse: a 2 MB `audio/webm` body reaches the audio route, while a 2 MB JSON body to
  `PUT /conversations/:id` still 413s.

## Risk and rollback

**Risk: the raw parser widens the JSON ceiling.** Mitigated structurally — the two parsers
dispatch on content type and never see each other's bodies — and proven by the pair of
regression gates above rather than by argument.

**Risk: a 32 MB buffer per in-flight upload.** Bounded and stated: 32 MB × the 6/min
throttle. This is the same bound shape the turn path already documents. The GET returns a
`Readable` rather than a `Buffer` so reads do not add a second 32 MB per concurrent
listener.

**Risk: the existing R2 token cannot write under a new prefix.** Open question 2 in
`plan.md` — confirm against the real token before deploying, not after. A prefix is not an
access boundary, so a bucket-scoped token should cover it; "should" is why it is a question.

**Rollback:** unbind `CONVERSATION_AUDIO_STORAGE`, remove the two routes and the raw mount.
The columns from Phase 2 stay and stay null. Objects already written are orphaned in R2 and
must be deleted by prefix by hand — `conversations/` makes that one operation.
