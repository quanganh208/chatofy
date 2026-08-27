---
phase: 4
title: 'Google picture import'
status: completed
priority: P2
effort: '4h'
dependencies: [2, 3]
---

# Phase 4: Google picture import

## Overview

Give a Google account an avatar without asking. Fetched server-side at login, stored
through the same validator and storage as an upload, and wrapped so it can never fail
the login it rides on.

## Requirements

- Functional: a Google login on a row whose avatar has never been touched imports the
  `picture` claim.
- Non-functional: login latency bounded by a short timeout; login never fails because
  of the import; the fetch cannot be redirected to an arbitrary host; a password login
  performs zero fetches.

## Architecture

**The gate is `avatarChangedAt == null`, not a null key.** A null `avatarKey` means
both "never had one" and "the user removed one", and importing over a removal would
leave a Google user with no way to have no picture — they remove it, and the next
login puts it back. `avatarChangedAt` is stamped by every avatar write including this
import, so the import happens at most once in a row's life and never after any
deliberate action. This is the reason that column exists (Phase 1).

**There is no single "after the row is resolved" point, and this is the phase's real
work.** `loginWithGoogle` has three terminal returns with three differently-named
bindings — `linked` (`auth.service.ts:102`), `created` (`:125`, inside a `try` whose
`catch` handles a lost unique race), and `linkedNow` (`:177`) — plus early throws
between them. There is no `user` variable to reassign.

`sessionFor` (`:203`) is NOT the hook point, even though all three call it. The
password login path calls it too (`:67`), where no `identity` exists; hooking there
would put a 3-second outbound fetch on every password login.

So: wrap the argument at each of the three sites, leaving control flow untouched.

```ts
return this.sessionFor(await this.withGoogleAvatar(linked, identity));
```

`loginWithGoogle` carries a 25-line comment on the account-linking policy it enforces
and is the most security-sensitive method in the codebase. Restructuring it to create a
single join point is explicitly out of scope for a P2 avatar phase; three identical
wrapper calls are the smaller change.

**Best-effort by construction.** `withGoogleAvatar` returns the row unchanged on any
failure and never throws. A person signing in does not care about their avatar in that
moment. This is the property most worth testing: login specs must assert a full session
with the fetch rejecting.

**Host allowlist parsed as a URL, not matched as a string.** The URL arrives inside a
Google-verified id_token, so it is not attacker-controlled in the usual sense — but the
API is making an outbound request to a value from a token payload, and the control has
to actually hold. A suffix match accepts `evilgoogleusercontent.com`; a raw-string check
accepts `https://lh3.googleusercontent.com@attacker.tld/`.

**Redirects are refused, not followed.** `fetch` follows up to 20 redirects by default,
which would make a single 30x bypass the allowlist entirely — and the API can reach
`http://localhost:8002` / `:8003` (the STT/TTS sidecars) and the compose network. With
the bytes landing in a _public_ bucket, a followed redirect is a read-SSRF exfiltration
primitive for anything whose first bytes sniff as an image. Google serves picture bytes
directly, so `redirect: 'manual'` costs nothing.

**Ask Google for the right size.** The `=s256-c` suffix returns a 256px square, so
there is nothing to resize — this is what keeps `sharp` out of the plan.

## Related Code Files

- Create: `apps/api/src/modules/storage/google-avatar-importer.ts`
- Create: `apps/api/src/modules/storage/google-avatar-importer.spec.ts`
- Modify: `apps/api/src/modules/auth/google-token-verifier.ts`
- Modify: `apps/api/src/modules/auth/auth.service.ts` (three call sites, one helper)
- Modify: `apps/api/src/modules/auth/auth.service.spec.ts`

## Implementation Steps

1. `google-token-verifier.ts`: add `picture?: string` to `GoogleIdentity`, populated
   the way `name` already is, with a comment noting it is untrusted **as a fetch
   target** even though the token is verified.

2. `google-avatar-importer.ts`:

   ```ts
   /**
    * Only Google's own picture host, only https, no credentials in the URL.
    *
    * Parsed with `new URL`, not string-matched: `endsWith('googleusercontent.com')`
    * also accepts `evilgoogleusercontent.com`, and a raw-string check accepts a
    * userinfo prefix like `https://lh3.googleusercontent.com@attacker.tld/`.
    */
   function isGooglePictureUrl(raw: string): boolean {
     let u: URL;
     try {
       u = new URL(raw);
     } catch {
       return false;
     }
     return (
       u.protocol === 'https:' &&
       u.username === '' &&
       u.password === '' &&
       (u.hostname === 'googleusercontent.com' || u.hostname.endsWith('.googleusercontent.com'))
     );
   }

   /** Drops any existing `=s...` suffix and asks for a 256px square crop. */
   function withSize(raw: string): string;

   /** Bytes, or null for any failure. Null rather than throwing: every caller is on
    *  the login path and must continue regardless. */
   export async function fetchGoogleAvatar(url: string, logger: Logger): Promise<Buffer | null>;
   ```

   `fetchGoogleAvatar` uses `redirect: 'manual'` and treats any 3xx as failure,
   `AbortSignal.timeout(3000)`, and reads the body with a running byte count that
   aborts past `MAX_AVATAR_BYTES` — a `Content-Length` header is a claim like any other.

3. `auth.service.ts`: add the private helper and wrap all three Google returns.

   ```ts
   /**
    * At most once per row, ever. `avatarChangedAt` — not a null key — is the gate:
    * a removed avatar also leaves a null key, and re-importing over a removal would
    * leave a Google user unable to have no picture.
    *
    * Returns the row unchanged on any failure. Nothing here may fail a login.
    */
   private async withGoogleAvatar(user: UserRecord, identity: GoogleIdentity): Promise<UserRecord> {
     if (user.avatarChangedAt !== undefined || !identity.picture) return user;
     try {
       const bytes = await fetchGoogleAvatar(identity.picture, this.logger);
       if (!bytes) return user;
       return await this.storeAvatarBytes(user.id, bytes);
     } catch (err) {
       this.logger.warn(err);
       return user;
     }
   }
   ```

   Apply at `:102` (`linked`), `:125` (`created`) and `:177` (`linkedNow`). Do NOT
   touch `sessionFor` — `:67` is the password path.

   Because the wrapper runs _before_ `sessionFor`, the returned `AuthSession` is built
   from the post-import row, so the first Google login's response already carries the
   `avatarUrl`. Phase 5 depends on that: `apps/web/auth.ts` copies it out of exactly
   this response.

4. Specs. `google-avatar-importer.spec.ts`: an allowed host is fetched; `evilgoogleusercontent.com`
   is refused; a userinfo-prefixed URL is refused; http is refused; a 302 (including one
   to `http://localhost:8002`) is refused without following; a body over the cap aborts;
   a timeout returns null; `withSize` handles a URL with and without an existing suffix.
   `auth.service.spec.ts`: each of the three Google branches imports on a fresh row; a
   row with a non-null `avatarChangedAt` does not fetch at all; a login succeeds with a
   full session when the fetch rejects, returns a non-image, or storage is disabled;
   **a password login performs zero fetches**; the first Google login's returned session
   carries a non-null `avatarUrl`.

## Success Criteria

- [ ] First Google login on a fresh account returns a session whose `avatarUrl` is non-null — in the login response itself, not only on a later `getMe`
- [ ] All three Google branches (`linked`, `created`, `linkedNow`) import; none is missed
- [ ] A row with a non-null `avatarChangedAt` never fetches — including one whose avatar was removed
- [ ] A user's own uploaded avatar survives every subsequent Google login
- [ ] A password login performs zero outbound fetches
- [ ] Login returns a full valid session when the fetch rejects, times out, or returns a non-image
- [ ] Login succeeds with R2 disabled; no avatar, no error surfaced
- [ ] A non-`googleusercontent.com` host, a lookalike host, a userinfo-prefixed URL, and an http URL are all refused without a request
- [ ] A 3xx response is refused, not followed
- [ ] A response body exceeding 256KB is aborted rather than fully buffered
- [ ] Imported bytes pass through the same sniff and key builder as an upload
- [ ] `pnpm --filter @chatofy/api test` and `pnpm turbo run typecheck` pass

## Risk Assessment

**Three insertion points invite one being missed.** Signal: an account whose first
Google login raced the create, or one linked from a password row, never gets an avatar
while the "fresh account" criterion still passes. Response: the spec list requires a
case per branch, which is why it is written as three and not one.

**The import adds an outbound call to the login path.** Signal: p95 login latency
rising. Response: at most once per row, bounded at 3s. If still too much, make the call
fire-and-forget without awaiting — the wrapper already returns the row either way, so
the change is local.

**Google changes the `=s256-c` contract.** Signal: imported avatars at the wrong size
or a 404. Response: the sniff and cap still hold, so the failure is a missing avatar
rather than a bad one.

**An avatar key pointing at a deleted object never re-imports.** Signal: a broken image
for a Google user. Response: accepted — the user can upload their own. Re-importing on
a stamped row is exactly what this phase refuses to do.
