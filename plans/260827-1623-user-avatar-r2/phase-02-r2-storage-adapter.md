---
phase: 2
title: 'R2 storage adapter'
status: completed
priority: P1
effort: '5h'
dependencies: [1]
---

# Phase 2: R2 storage adapter

## Overview

A storage seam the rest of the API talks to, with an R2 implementation and a
disabled implementation for when R2 is unconfigured. Also the image validator both
write paths share. No HTTP route yet.

## Requirements

- Functional: put and delete an object on R2; decide an image's type from its bytes;
  refuse anything over 256KB or not an image.
- Non-functional: nothing touches the filesystem; missing R2 config disables the
  feature rather than failing boot; a delete failure is reportable, never silent;
  credentials never appear in a response or a log.

## Architecture

**Two implementations behind one token, chosen at module construction.** This mirrors
`MailSender` / `NoopMailSender`: `getSmtpConfig(config)` returns undefined when the set
is incomplete and the module provides the noop. `getR2Config(config)` does the same —
all five variables or none, so there is no half-configured state where `put` succeeds
and no URL can be composed.

**No production boot gate, and the honest reason.** An earlier draft justified this by
saying a failed upload "reports itself" as a 503 the user can see. That is false:
`all-exceptions.filter.ts` rewrites every 5xx to code `INTERNAL_ERROR` and message
`'Internal server error'`, so a storage-unavailable 503 is byte-identical to a crash.
The real reason to skip the gate is narrower and still holds: avatars are a P2 feature
and refusing to boot production over them would block unrelated deploys. What replaces
the false claim is concrete — a startup warning when `getR2Config` returns undefined in
production, and a 4xx (not 5xx) at the endpoint so the message survives the filter.
See Phase 3.

**`DisabledAvatarStorage.delete` must NOT resolve silently.** The earlier draft had it
succeed so a removal could never fail. On a public-read bucket that is the wrong
default: it lets "remove my photo" report success while the bytes stay published. It
now throws the same named error as `put`, and Phase 3 turns that into a reportable
failure with the column left intact so the user can retry.

**Type comes from magic bytes.** These are user-supplied bytes served from an origin
the browser treats as ours. A client-declared content type is a claim, not evidence,
and pinning `ContentType` from a sniffed value is what stops an HTML payload being
served back as HTML.

**Cache lifetime is one hour, and `immutable` is gone.** The content hash in the key
makes a _replacement_ safe at any TTL — a new avatar is a new URL. Deletion is the case
that governs, and `immutable` for a year on a deletable public object means a photo the
user took down keeps being served from the edge long after the origin object is gone.
One hour bounds that window to something a person can be told about.

**The key carries a content hash plus random entropy.**
`avatars/{userId}/{random16}-{sha256(bytes).slice(0,16)}.{ext}`. The hash alone is not
a secret: for a Google-imported avatar the bytes are a public artifact fetched from a
deterministic URL, so anyone holding the same image and the user id can recompute the
key. The random half makes unguessability a real property rather than a claimed one.
Even so, the plan does not lean on it — see the honesty note in `plan.md`.

**Byte cap 256KB.** A 128px webp is 5–15KB in practice. It bounds bytes, not pixels —
see the risk below.

## Related Code Files

- Create: `apps/api/src/modules/storage/interfaces/avatar-storage.interface.ts`
- Create: `apps/api/src/modules/storage/r2-avatar-storage.ts`
- Create: `apps/api/src/modules/storage/disabled-avatar-storage.ts`
- Create: `apps/api/src/modules/storage/avatar-image.ts`
- Create: `apps/api/src/modules/storage/storage.module.ts`
- Create: `apps/api/src/modules/storage/avatar-image.spec.ts`
- Create: `apps/api/src/modules/storage/r2-avatar-storage.spec.ts`
- Modify: `apps/api/src/config/env.schema.ts` (four remaining `R2_*` keys)
- Modify: `apps/api/src/main.ts` (production warning when storage is unconfigured)
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/package.json` (add `@aws-sdk/client-s3`)

## Implementation Steps

1. `pnpm --filter @chatofy/api add @aws-sdk/client-s3`. R2 is S3-compatible; this is
   the only new runtime dependency in the whole plan.

2. `env.schema.ts`: add the four remaining variables (`R2_PUBLIC_BASE_URL` landed in
   Phase 1), all optional, following the SMTP block's convention:
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

3. `avatar-image.ts` — pure functions, no Nest imports, reused by Phase 4's importer:

   ```ts
   export const MAX_AVATAR_BYTES = 256 * 1024;

   export type AvatarImageType = { mime: string; ext: string };

   /** Decides the type from the bytes themselves. Null means "not an image we accept". */
   export function sniffAvatarImage(bytes: Buffer): AvatarImageType | null;

   /** `avatars/{userId}/{random16}-{hash16}.{ext}` — see the phase notes on entropy. */
   export function buildAvatarKey(userId: string, bytes: Buffer, type: AvatarImageType): string;
   ```

   Accept exactly webp (`RIFF....WEBP`), png (`\x89PNG\r\n\x1a\n`) and jpeg
   (`\xFF\xD8\xFF`). Check the cap before sniffing.

4. `avatar-storage.interface.ts`:

   ```ts
   export const AVATAR_STORAGE = Symbol('AVATAR_STORAGE');

   /** Storage is unconfigured. Phase 3 maps this to a 4xx whose message survives the error filter. */
   export class AvatarStorageUnavailableError extends Error {}

   export interface AvatarStorage {
     readonly enabled: boolean;
     put(key: string, bytes: Buffer, contentType: string): Promise<void>;
     /**
      * Removes the object. Resolves when the object is gone or was already gone;
      * REJECTS on any other failure.
      *
      * Not best-effort, and not silent when storage is disabled: the bucket is
      * public-read, so a delete that quietly does nothing leaves a photograph
      * published after its owner asked for it to be taken down.
      */
     delete(key: string): Promise<void>;
   }
   ```

5. `r2-avatar-storage.ts`: an `S3Client` with
   `endpoint: https://{accountId}.r2.cloudflarestorage.com`, `region: 'auto'`, and the
   key pair. `put` issues `PutObjectCommand` with the sniffed `ContentType` and
   `CacheControl: 'public, max-age=3600'`. `delete` issues `DeleteObjectCommand`,
   treating a `NoSuchKey`/404 as success and propagating everything else.

6. `disabled-avatar-storage.ts`: `enabled = false`; both `put` and `delete` throw
   `AvatarStorageUnavailableError`.

7. `storage.module.ts`: export `getR2Config(config)` returning the complete five-field
   object or undefined, and provide `AVATAR_STORAGE` from a factory that picks the
   implementation. Register in `app.module.ts`.

8. `main.ts`: when `NODE_ENV=production` and `getR2Config` is undefined, log one
   warning naming the missing capability. A warning, not a throw — the boot gate stays
   off deliberately; this is what makes the misconfiguration findable in a log instead
   of only through a user complaint.

9. Specs. `avatar-image.spec.ts`: each accepted signature sniffs correctly; a text
   payload returns null; 256KB+1 is rejected; the same bytes twice produce _different_
   keys (entropy) but the same hash segment; different bytes change the hash segment.
   `r2-avatar-storage.spec.ts`: a mocked `S3Client` receives the expected bucket, key,
   ContentType and `max-age=3600`; `delete` on a missing key resolves; `delete` on a
   permission error rejects.

## Success Criteria

- [ ] API boots with all five R2 variables unset; `AVATAR_STORAGE` resolves to the disabled implementation
- [ ] API boots in `NODE_ENV=production` with R2 unset, and logs exactly one warning saying so
- [ ] A partially configured R2 set resolves to disabled, not to a half-working client
- [ ] `DisabledAvatarStorage.delete` **rejects** — it does not resolve silently
- [ ] `R2AvatarStorage.delete` resolves for an already-missing key and rejects for a permission failure
- [ ] Uploaded objects carry the sniffed `ContentType` and `public, max-age=3600`, with no `immutable`
- [ ] The same image uploaded twice produces two different keys
- [ ] A payload over 256KB is refused before any sniff or network call
- [ ] A non-image payload is refused regardless of any declared type
- [ ] No R2 credential appears in a log line or an error message
- [ ] `pnpm --filter @chatofy/api test` and `pnpm turbo run typecheck` pass

## Risk Assessment

**The cap bounds bytes, not pixels.** A 2000×2000 image can compress under 256KB.
Signal: unusually large avatars in the bucket. Response: accept it — CSS pins the
rendered size, so the cost is bandwidth only. A hard dimension guarantee needs `sharp`,
deliberately not taken.

**One hour of edge cache is still a deletion window.** Signal: a user reporting their
removed photo is still reachable. Response: this is now a stated, bounded property
rather than an unexamined year — Phase 6 documents the window. Shortening it further
trades against cache hit rate; a Cloudflare purge call would close it but needs a
second API token and is out of scope.

**Half-configured R2 in a real deployment.** Signal: uploads failing in production
while the operator believes R2 is set up. Response: `getR2Config` is all-or-nothing by
construction, step 8 logs it at boot, and Phase 6's runbook lists all five together.

**`@aws-sdk/client-s3` is a large dependency.** Signal: API image size grows. Response:
acceptable — it is the supported R2 path and adds no native build step.
