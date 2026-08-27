---
phase: 5
title: 'Web avatar surface'
status: completed
priority: P1
effort: '7h'
dependencies: [1, 3]
---

# Phase 5: Web avatar surface

## Overview

Make the avatar visible and changeable: open the CSP to the R2 origin, carry the URL
in the session without trusting the browser for it, render it in the sidebar footer and
on `/account`, and add the change/remove control with client-side resizing.

## Requirements

- Functional: avatar renders wherever identity is shown, with initials as fallback;
  `/account` can change and remove it; the sidebar updates without a reload.
- Non-functional: no Google-hosted image URL survives in the session; nothing the
  browser sends is written into the signed cookie unchecked; both locales carry every
  new string; no layout shift.

## Architecture

**`token.picture` is already populated, and that is the trap in this phase.**
`apps/web/auth.ts:99-102` uses the built-in `Google({...})` provider, whose default
`profile()` maps Google's `picture` claim to `user.image`; `@auth/core` seeds the JWT
from `user` before the repo's `jwt` callback runs and builds `session.user.image` from
`token.picture` before the repo's `session` callback runs. Neither callback touches
either field today, so every Google user's cookie _already_ carries an
`lh3.googleusercontent.com` URL.

The consequence: the moment `<AvatarImage src={image}>` is added, that URL is requested
on every authenticated page and blocked by `img-src`, which names only the R2 origin.
So the copy in the Google `signIn` branch must be **unconditional, including null**:

```ts
user.image = result.session.user.avatarUrl; // null clears it — do NOT guard on truthiness
```

A conditional copy is the natural reading and it is the bug: it leaves the Google URL
in place for exactly the users whose import failed. The sidebar's existing comment
("the session carries none — `auth.ts` copies id, email, name and the API token, and
nothing else") is already wrong today for the Google path, and must be corrected rather
than extended.

**`trigger === 'update'` does not trust its payload.** `useSession().update(data)` POSTs
`data` from the browser and it arrives in the `jwt` callback. Writing it straight into
the signed cookie would let any script — and `next.config.ts`'s own comment concedes
`script-src` carries `'unsafe-inline'`, so injected inline script runs — persist an
arbitrary `image` value for the session's 30 days. On an update trigger, ignore the
payload and re-read `GET /auth/me` with `token.accessToken`, taking `avatarUrl` from
the API. The client's role is to say _something changed_, not _what it changed to_.

**The CSP origin is normalized, not interpolated raw.** `next.config.ts` does not import
`src/config/env.ts` — it reads `process.env` directly, as it already does for the API
origin — so the zod entry validates nothing for the one consumer where a malformed
value is dangerous. `new URL(raw).origin` strips paths and trailing slashes, makes a
`;` impossible (it would throw at build), and is what actually guarantees a valid CSP
source expression. A value like `https://cdn.example/avatars/` is a legal URL and an
invalid source expression; only normalization catches it.

**Resize in the browser**, so the API needs no `sharp`. `AvatarImage` renders at 32px
(40px at `size="lg"`), so 128 covers a 2× display.

**Accent budget.** `development-rules.md` allows one `bg-primary` control per app screen
and names `/account`. It currently has **zero** — both buttons are `variant="outline"`.
Keep the avatar controls outline too; the screen stays accent-free deliberately.

**A new file, not a bigger card.** `account-card.tsx` is ~140 lines with two `<Card>`s.
Adding an avatar row, a hidden file input, resize wiring and three error states pushes
it past the 200-line threshold `CLAUDE.md` sets, so the avatar card goes in
`account-avatar-card.tsx` and `AccountCard` composes it.

## Related Code Files

- Modify: `apps/web/next.config.ts`
- Modify: `apps/web/src/config/env.ts`
- Modify: `apps/web/.env.example`
- Modify: `apps/web/auth.ts`
- Modify: `apps/web/src/components/layout/session-menu.tsx`
- Modify: `apps/web/src/components/account/account-card.tsx` (compose the new card)
- Create: `apps/web/src/components/account/account-avatar-card.tsx`
- Create: `apps/web/src/components/account/account-avatar-card.spec.tsx`
- Create: `apps/web/src/components/layout/session-menu.spec.tsx`
- Modify: `apps/web/src/clients/api-client.ts`
- Create: `apps/web/src/lib/avatar-crop-geometry.ts`
- Create: `apps/web/src/lib/avatar-crop-geometry.spec.ts`
- Create: `apps/web/src/lib/resize-avatar.ts`
- Modify: `packages/i18n/src/en.ts`, `packages/i18n/src/vi.ts`

## Implementation Steps

1. `env.ts`: add `NEXT_PUBLIC_AVATAR_BASE_URL: z.string().url().optional()`.
   `.env.example` gets it with a comment that it is build-time and feeds the CSP.

2. `next.config.ts`, inside `contentSecurityPolicy()`:

   ```ts
   // Same build-time rule as NEXT_PUBLIC_API_BASE_URL above: avatars come from the
   // R2 bucket's public domain, which is NOT 'self'. Set only at runtime, the header
   // names nothing and the browser blocks every avatar while the page still renders.
   //
   // `.origin` rather than the raw value: a path or trailing slash is a legal URL and
   // an invalid CSP source expression, and a value containing `;` would inject
   // directives. A malformed value throws here, at build, which is the point.
   const avatarOrigin = process.env.NEXT_PUBLIC_AVATAR_BASE_URL
     ? new URL(process.env.NEXT_PUBLIC_AVATAR_BASE_URL).origin
     : undefined;
   // ...
   `img-src 'self' data: blob:${avatarOrigin ? ` ${avatarOrigin}` : ''}`,
   ```

3. `auth.ts`, all three seams:
   - `authorize` (Credentials): copy `result.session.user.avatarUrl` onto `user.image`.
   - `signIn` (Google branch): `user.image = result.session.user.avatarUrl` —
     **unconditional**, so null clears the provider-supplied Google URL.
   - `jwt({ token, user, trigger })`: on sign-in set `token.picture = user.image ?? null`.
     On `trigger === 'update'`, ignore the incoming payload and re-read `GET /auth/me`
     with `token.accessToken`, setting `token.picture` from the response's `avatarUrl`;
     on any failure leave the token unchanged.
   - `session({ session, token })`: `session.user.image = token.picture ?? null`.

   No module augmentation is needed — `next-auth.d.ts` augments only `accessToken`, and
   `image` is already on `DefaultSession["user"]`.

4. `api-client.ts`, beside `updateMe`, guarded and enveloped the same way:
   `uploadAvatar(body: UploadAvatarRequest)` → `PUT /auth/me/avatar`;
   `deleteAvatar()` → `DELETE /auth/me/avatar`. Both parse into `userSchema`.

5. `avatar-crop-geometry.ts`: a pure function
   `coverCrop(srcW, srcH, size)` → `{ sx, sy, sw, sh }` implementing the centre cover
   crop. Pure so it can be tested in the node environment the web test runner actually
   uses (see step 9).

6. `resize-avatar.ts`: `File` → `createImageBitmap` → canvas `size×size` drawn with
   `coverCrop`'s rectangle → `toBlob('image/webp', 0.85)` → base64. Reject a non-image
   before decoding, and treat a null `toBlob` result as a typed failure rather than an
   assumed success. Fall back to `image/png` when webp encoding yields null — the API
   accepts png via the sniff, so this needs no server change and no polyfill.

7. `session-menu.tsx`: add `<AvatarImage src={image} alt="" />` above the existing
   `<AvatarFallback>`. Radix shows the fallback on its own when the image is absent or
   fails, so the initials path needs no branching. `alt=""` because the name sits beside
   it and the trigger has an `aria-label`. Rewrite the stale paragraph — both of its
   claims (no avatar image; the session carries nothing but id/email/name/token) are
   wrong, the second already before this phase.

8. `account-avatar-card.tsx`: `Avatar size="lg"` with image and fallback, a hidden
   `<input type="file" accept="image/*">`, and two `variant="outline"` buttons — change
   and remove, remove rendered only when `avatarUrl` is non-null. On success set local
   state and call `useSession().update()` so the sidebar swaps; show failures inline and
   leave the previous image visible on a failed change.

   Note the one state this cannot represent: `avatarUrl` is also null when a key exists
   but `R2_PUBLIC_BASE_URL` is unset, which hides Remove for a row that has an avatar.
   Reaching it requires configuring an environment downward after an upload — the five
   R2 variables are all-or-nothing, so an environment that never had the base could
   never have accepted an upload. Restoring the variable restores the control; the
   endpoint works throughout. Documented rather than solved with a second contract field.

9. i18n: add to `en.ts` and `vi.ts` under `web.account` — label, change, remove, and
   distinct failures for "not an image", "too large", "upload failed", and
   "storage unavailable" (the 409 from Phase 3, which carries a real message because it
   is 4xx). **The parity gate is `tsc`, not a spec:** `t.spec.ts` never imports `vi` and
   has no key-set comparison; `vi.ts` is typed `Messages` derived from `en as const`, and
   `en.ts:3-7` says explicitly that no parity test is to be written. Verify with
   `pnpm turbo run typecheck`, not `test`.

10. Specs. `avatar-crop-geometry.spec.ts`: a square input maps 1:1; a wide input crops
    the sides and keeps full height; a tall input crops top and bottom; the output
    rectangle is always square. `account-avatar-card.spec.tsx` (`// @vitest-environment
happy-dom`): renders the image when present, initials when not; remove hidden with no
    avatar; a failed upload shows a message and does not clear the existing avatar; a 409
    shows the storage-unavailable string. `session-menu.spec.tsx`: image when present,
    initials otherwise, loading skeleton unchanged.

    Do **not** write a spec asserting the produced blob is 128×128 or "not squashed":
    `apps/web/vitest.config.ts` sets `environment: 'node'`, the only DOM available is
    happy-dom (no canvas raster backend, no `createImageBitmap`, no working `toBlob`),
    and no canvas package is a dependency. Such a spec could only assert against its own
    stubs. The geometry is proved by step 5's pure function; the encode path is verified
    by hand.

## Success Criteria

- [ ] Built with `NEXT_PUBLIC_AVATAR_BASE_URL` set, the response CSP names that **origin** in `img-src` — with any path or trailing slash stripped
- [ ] A malformed value fails the build rather than emitting a broken directive
- [ ] Built without it, `img-src` is exactly today's value — no empty token
- [ ] After a Google sign-in whose `avatarUrl` is null, `session.user.image` is null — no `googleusercontent.com` URL survives
- [ ] No request to `lh3.googleusercontent.com` is made from any authenticated page
- [ ] `useSession().update()` with a forged `image` payload does not change `token.picture`
- [ ] Avatar renders in the sidebar footer and on `/account`; initials show when there is none
- [ ] A blocked or broken image URL falls back to initials, not a broken-image icon
- [ ] Changing the avatar updates the sidebar without a page reload
- [ ] A non-image file, an oversized file, and a 409 each show their own message
- [ ] A failed upload leaves the previous avatar visible
- [ ] `/account` still has zero `bg-primary` controls
- [ ] `account-card.tsx` stays under 200 lines; the avatar card is its own file
- [ ] `pnpm --filter @chatofy/web test` passes
- [ ] **`pnpm turbo run typecheck` passes** — this, not `test`, is what catches a missing `vi` key

## Risk Assessment

**A conditional `user.image` copy ships a permanently CSP-blocked image.** Signal: CSP
violations naming `lh3.googleusercontent.com` on every authenticated page, reported as
"the Google import doesn't work". Response: the unconditional-copy rule is in step 3 and
has its own success criterion. The wrong repair — adding `googleusercontent.com` to
`img-src` — would turn every page view into a Google-visible request from an
authenticated session, so it is called out here explicitly.

**The CSP origin is missing from a build and every avatar silently fails.** Signal:
initials everywhere in a deployed environment. Response: Phase 6 adds a deploy-time
assertion on the served header, which is the only check that survives a Dockerfile or
env mistake.

**`session.update()` does not propagate on some navigation paths.** Signal: `/account`
shows the new avatar while the sidebar shows the old. Response: the URL is
content-hashed, so a stale value points at a valid object, and a reload fixes it. If
flaky, have `session-menu` read from `getMe` — the account card already does.

**`createImageBitmap` or webp encoding unavailable on a device.** Signal: resize
throwing in production. Response: the png fallback in step 6; no polyfill.
