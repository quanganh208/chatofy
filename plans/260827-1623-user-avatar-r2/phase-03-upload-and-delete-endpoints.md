---
phase: 3
title: 'Upload and delete endpoints'
status: completed
priority: P1
effort: '5h'
dependencies: [1, 2]
---

# Phase 3: Upload and delete endpoints

## Overview

The two routes that let an account holder set and clear their own avatar, wired to
the storage seam from Phase 2 and the columns from Phase 1.

## Requirements

- Functional: `PUT /auth/me/avatar` stores an image and returns the updated `User`;
  `DELETE /auth/me/avatar` removes the object and clears the columns.
- Non-functional: the row changed is always the caller's own; a delete that cannot
  reach storage reports failure instead of claiming success; a bad payload gives 400
  and writes nothing; the routes are rate limited.

## Architecture

**No user id in either request.** `auth.controller.ts` already spells out why for
`PATCH /auth/me`: a field naming whose row to change turns a settings endpoint into
horizontal privilege escalation, and the way to guarantee it is absent is to have no
field for it. The id comes from `req.auth!.userId`.

**Storage-unavailable is a 4xx, not a 503.** Two independent reasons. First,
`ApiErrorResponses` throws at class-decoration time for any status not in its table,
and the table has 400, 401, 403, 404, 409, 429, 500 — `@ApiErrorResponses(..., 503)`
would take the whole API down at import, not just avatars. Second, `errorCodeSchema`
has no 5xx code beyond `INTERNAL_ERROR`, and `all-exceptions.filter.ts` replaces every
5xx message with `'Internal server error'` — so a 503 could not tell the client
anything a crash does not. A 4xx keeps its message
(`messageFromHttpException`), which is the property that makes the failure diagnosable.

`409 Conflict` is the status: the request is well-formed and the caller is authorised;
the server's current state cannot satisfy it. That is an imperfect fit — the conflict
is a server misconfiguration, not a client-visible resource state — and it is chosen
because it is the least wrong code already in the shared contract. Adding
`SERVICE_UNAVAILABLE` to `errorCodeSchema` would be more honest and was deliberately
declined as a change to a contract shared by api, web and mobile for a P2 feature.

**Delete is authoritative, not best-effort.** The bucket is public-read, so a removal
that clears the column while the object survives means a photograph stays published
after its owner asked for it to be taken down — and the user was told 200. So
`removeAvatar` deletes the object FIRST and only clears the columns once that
succeeds. Storage unreachable or unconfigured → 409, columns untouched, the user can
retry. This inverts an earlier draft's criterion; it is the deliberate trade the
product decision made.

**Replace ordering stays object-first, and its old-object delete stays best-effort.**
The two cases are genuinely different: a replaced avatar is one the user still wants
published, so a leftover object is storage waste, and failing the whole change over it
would be worse than the leak it prevents. Only removal has a person asking for bytes
to stop existing.

**JSON base64, not multipart.** The JSON limit is already 12mb for base64 audio, so no
`multer` is needed, and Phase 4's importer reaches the same validator with a plain
`Buffer`. The request carries **raw base64**, not a data URL: a data URL prefix
declares a mime type the server is not allowed to trust.

**Both routes carry an explicit `@Throttle`.** Note the precedent honestly: `PATCH
/auth/me` carries none, so it is not true that every mutating route is throttled. But
that route's body is two characters and it performs no network write. This one accepts
the largest bodies in the controller and issues billable writes to an object store, so
inheriting the module default of 60/min is wrong for it.

## Related Code Files

- Modify: `packages/types/src/http/auth.ts`
- Modify: `apps/api/src/modules/auth/dto/auth.dto.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/auth/auth.module.ts` (inject `AVATAR_STORAGE`)
- Modify: `apps/api/src/modules/auth/auth-flow.harness.ts` (a fake `AvatarStorage`)
- Modify: `apps/api/src/modules/auth/auth.service.spec.ts` (constructor gains a dependency)
- Create: `apps/api/src/modules/auth/avatar-endpoints.spec.ts`
- Modify: `apps/api/test/auth.db-e2e-spec.ts`

## Implementation Steps

1. `packages/types/src/http/auth.ts`, beside `updateMeRequestSchema`:

   ```ts
   // Raw base64, no data-URL prefix: the prefix declares a mime type the API is not
   // allowed to trust (the bytes decide — see the storage module's sniff), so
   // accepting one would be a format to parse for a value that gets discarded.
   //
   // The max is a pre-decode guard on the DECODE allocation only. It is NOT a
   // memory bound on the request: this schema runs in a Nest pipe, which is
   // downstream of the body parser — Express has already read and JSON.parsed up to
   // 12mb by the time zod sees anything. The transport-level limit in the controller
   // is what bounds that.
   export const uploadAvatarRequestSchema = z.object({
     image: z.string().min(1).max(400_000),
   });
   export type UploadAvatarRequest = z.infer<typeof uploadAvatarRequestSchema>;
   ```

2. `auth.dto.ts`: `UploadAvatarRequestDto extends createZodDto(uploadAvatarRequestSchema)`,
   with a comment mirroring `UpdateMeRequestDto`'s note about carrying no user id.

3. `auth.controller.ts`: two guarded routes (no `@Public()`).

   ```ts
   @Put('me/avatar')
   @ApiBearerAuth()
   @Throttle({ default: { limit: 10, ttl: 60_000 } })
   @ApiOperation({ summary: "Replace the authenticated caller's avatar" })
   @ApiEnvelopeResponse(UserDto)
   @ApiErrorResponses(400, 401, 409, 429)
   setAvatar(@Req() req: Request, @Body() dto: UploadAvatarRequestDto): Promise<User> {
     return this.auth.setAvatar(req.auth!.userId, dto.image);
   }

   @Delete('me/avatar')
   @ApiBearerAuth()
   @Throttle({ default: { limit: 10, ttl: 60_000 } })
   @ApiOperation({ summary: "Remove the authenticated caller's avatar" })
   @ApiEnvelopeResponse(UserDto)
   @ApiErrorResponses(401, 409, 429)
   removeAvatar(@Req() req: Request): Promise<User> {
     return this.auth.removeAvatar(req.auth!.userId);
   }
   ```

   Every status listed must exist in `ERROR_RESPONSES` — the helper throws at import
   otherwise. 400/401/409/429 all do; 503 does not.

4. Bound the body at the transport layer for this route rather than relying on zod.
   A route-scoped raw-body limit (~512KB) in the controller or a middleware matched to
   `/auth/me/avatar` keeps a 12mb payload from being buffered and parsed before any
   validation runs.

5. `auth.service.ts`, injecting `AVATAR_STORAGE`:

   - `setAvatar(userId, base64)`:
     1. `storage.enabled` false → `ConflictException('Avatar storage is not configured')`
        before decoding.
     2. `Buffer.from(base64, 'base64')`; reject with `BadRequestException` when the
        result is empty — invalid base64 decodes to garbage, it does not throw.
     3. Length over `MAX_AVATAR_BYTES` → `BadRequestException`.
     4. `sniffAvatarImage` null → `BadRequestException`.
     5. Read the current row to remember `avatarKey`.
     6. `buildAvatarKey` → `storage.put` → `updateAvatarKey(id, key, now)`.
     7. If a previous key exists and differs, `storage.delete` it inside a `try/catch`
        that logs and continues — best-effort, for the reason in Architecture.
     8. Return `toUserContract(updated, publicBase)`.
   - `removeAvatar(userId)`:
     1. Read the row. No `avatarKey` → stamp nothing, return the contract as-is (200;
        the caller asked for a state and it holds).
     2. `storage.delete(key)` — **await it and let it throw.**
        `AvatarStorageUnavailableError` → `ConflictException`; any other storage error
        → `ConflictException` with a retryable message. The columns stay as they were.
     3. Only on success: `updateAvatarKey(id, null, now)`.
     4. Return the contract.

6. Extract the validate-and-store body into a private `storeAvatarBytes(userId, bytes)`
   so Phase 4's importer calls one function rather than repeating steps 2–7.

7. Guard the read-then-write window. `updateAvatarKey` is an unconditional update
   inside a read-then-write sequence, so two tabs uploading and removing concurrently
   can leave the column naming an object the delete already removed. The repository
   already documents the remedy for this exact class at
   `prisma-user.repository.ts:231-240` (`linkGoogleSub`'s conditional write): make the
   clear in `removeAvatar` conditional on `avatarKey` still equalling the key that was
   read, and treat "no row updated" as a lost race rather than an error.

8. Specs (`avatar-endpoints.spec.ts`), using `mockUsers()` and a fake `AvatarStorage`:
   valid webp stores and returns a non-null `avatarUrl`; oversized / non-image /
   undecodable → 400 with no `put`; storage disabled → 409 with no column write;
   replacing deletes the old key; a throwing old-key delete still returns 200;
   **`removeAvatar` with storage disabled → 409 and the column is UNCHANGED**;
   `removeAvatar` with a rejecting delete → 409 and the column is unchanged;
   `removeAvatar` on a row with no avatar → 200.

9. Extend `auth.db-e2e-spec.ts` with the envelope shape for both routes and a 401 for
   an unauthenticated call.

## Success Criteria

- [ ] `PUT /auth/me/avatar` with a valid image returns the enveloped `User` with a non-null `avatarUrl`
- [ ] Neither request body has any field naming a user id
- [ ] Oversized, non-image, and undecodable payloads return 400 and call no storage method
- [ ] Storage disabled → `PUT` returns **409** with a message naming the cause, and the columns are untouched
- [ ] Storage disabled → `DELETE` returns **409** and the columns are **untouched**, so the user can retry
- [ ] A storage delete failure on removal returns 409 and does not clear the columns
- [ ] Replacing an avatar deletes the previous object; a failure there does not fail the request
- [ ] `DELETE` on a row with no avatar returns 200, not 404
- [ ] Both routes reject an unauthenticated caller with 401 and are throttled at 10/min
- [ ] A 12mb body is refused at the transport layer, before the JSON parser buffers it
- [ ] The API still boots — every status passed to `@ApiErrorResponses` exists in its table
- [ ] `/docs` shows both routes with the envelope response
- [ ] `pnpm --filter @chatofy/api test` and `pnpm turbo run typecheck` pass
- [ ] `pnpm --filter @chatofy/api test:e2e:db` passes — note `test:e2e` **ignores** `.db-e2e-spec.ts` by config and needs a live Postgres

## Risk Assessment

**409 is semantically imperfect for a server misconfiguration.** Signal: a reviewer or
a client author reading it as a resource conflict. Response: the message says what
happened and the phase records why 503 is unavailable. If the shared contract ever
gains `SERVICE_UNAVAILABLE`, this is the first call site to move.

**Authoritative delete means a user cannot remove their avatar while R2 is down.**
Signal: 409s on removal during an R2 incident. Response: this is the accepted trade —
a retryable error is better than a false confirmation for a takedown request. The
message must say "try again", not "failed".

**Invalid base64 decodes silently.** `Buffer.from(x, 'base64')` discards what it cannot
parse rather than throwing. Response: the empty-buffer check in step 5.2 plus the
sniff; a spec asserts a junk string returns 400.

**Orphaned objects when a column write fails after `put`.** Signal: bucket object count
drifting above user count. Response: accepted for the replace path; storage cost only,
and the column stays authoritative.
