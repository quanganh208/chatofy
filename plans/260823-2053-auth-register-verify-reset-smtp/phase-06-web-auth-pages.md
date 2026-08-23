---
phase: 6
title: 'Web auth pages'
status: completed
priority: P1
effort: '1d'
dependencies: [4, 5]
---

# Phase 6: Web auth pages

## Overview

Four new unauthenticated pages. The login form is left alone — deferred
registration means login gained no new status, so there is nothing new to
surface there.

## Requirements

- Functional: a person can register, verify, sign in, forget, reset and sign in
  again entirely through the browser.
- Non-functional: NextAuth stays a thin session shell. No page gains database
  access or an identity secret.

## Architecture

### Exempt the routes from the signed-out redirect — step one, or nothing works

`apps/web/proxy.ts` (Next 16's renamed `middleware.ts`) redirects every route
with no session to `/login`. Its matcher excludes only `api/auth`, `login$`,
`login/`, `_next/static`, `_next/image`, `worklets`, and dotted asset paths — so
**all four new routes match it and redirect.** The feature would be unreachable
for exactly the people it exists for.

Worse for the mail links: `proxy.ts:24` writes `pathname + search` into the login
URL, so `/verify-email?token=eyJ…` becomes
`/login?next=%2Fverify-email%3Ftoken%3D…` — the live token copied into a second
URL and into history, on a page that never mounts. The "no token in
`location.search`" criterion below would pass while the opposite happened.

Extend the negative lookahead. Copy the existing `login$|login/` two-clause
shape: a bare prefix would also swallow `/registersomething`, and the comment at
`proxy.ts:29-38` records a past bug from getting this pattern wrong.

### What the forms call

The new forms run **client-side**. `auth.ts`'s `postToApi` is server-side — it
runs inside the NextAuth route handler — so it cannot serve them.

`packages/api-client` is a generic envelope-validating `apiFetch` with no
per-endpoint knowledge; endpoints live in the app wrapper
`apps/web/src/clients/api-client.ts`, which today exports only `translate()`. Add
`register`, `verifyEmail`, `forgotPassword`, `resetPassword` there.

Use a **second client instance with no `getHeaders`** for these. The existing one
calls `getSession()` on every request, which is a `/api/auth/session` round trip
before every submit for a header that will always be `{}` — and on
`/verify-email` it runs for a visitor who by construction has no session.

| Route                    | Behaviour                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `/register`              | Form + the existing `GoogleButton`. On 202 → "check your email". No auto sign-in — no account exists yet. |
| `/verify-email?token=`   | Posts the token, then → `/login?verified=1`                                                               |
| `/forgot-password`       | Uniform confirmation text regardless of what the API did                                                  |
| `/reset-password?token=` | New password → `/login?reset=1`                                                                           |

`GoogleButton` belongs on `/register` too: `/auth/google` already auto-creates
accounts, so "sign up with Google" costs nothing extra. Both pages follow
`/login`'s existing `googleConfigured` + `Suspense` structure — read
`app/login/page.tsx` first and match it rather than inventing a second shape.

### Token-in-URL hygiene, in order of how real each is

1. **Email scanners GET the link.** The GET must consume nothing — the token is
   spent only on an explicit POST. Never a magic GET.
2. **Browser history on shared machines.** `history.replaceState` strips the
   query on mount; hold the token in component state.
3. **Referer.** Already handled: `next.config.ts:73` sets
   `Referrer-Policy: strict-origin-when-cross-origin` on `/:path*`, which strips
   path and query cross-origin. **Add no second header** — a route-specific
   `no-referrer` entry with the same key has unverified merge behaviour, and
   would trade a real guarantee for an assumed one. Just keep the token pages
   free of third-party subresources.

A re-followed verification link must render "this account already exists — sign
in" rather than an error. Double-clicking a link in a mail client is ordinary,
and the second redemption legitimately loses to the unique index.

## Related Code Files

- Modify: `apps/web/proxy.ts` — **exempt the four routes, or none of them load**
- Modify: `apps/web/src/clients/api-client.ts` — the four endpoint functions on a
  token-free client instance
- Create: `apps/web/app/register/page.tsx`, `verify-email/page.tsx`,
  `forgot-password/page.tsx`, `reset-password/page.tsx`
- Create: `apps/web/src/components/auth/register-form.tsx`,
  `forgot-password-form.tsx`, `reset-password-form.tsx` (+ specs)
- Modify: `apps/web/app/login/page.tsx` — links to register/forgot, and
  `?verified=` / `?reset=` notices in the existing table's style
- Read: `packages/ui/src/react/index.ts` — reuse `Button`, `Input`, `Label`,
  `Card`; add no new primitive

**Not** modified: `apps/web/src/components/auth/login-form.tsx` and `auth.ts`.
Login gained no new behaviour, so neither does the form.

## Implementation Steps

1. Exempt the four routes in `proxy.ts` and confirm each loads signed out.
   Nothing else in this phase is observable until this is done.
2. Add the four endpoint functions on a token-free client instance.
3. Build `/register`, mirroring `/login`'s server-component structure including
   the signed-in redirect.
4. Build `/forgot-password` — its copy must not vary with the API's answer.
5. Build `/verify-email` and `/reset-password` with the hygiene above.
6. Extend `/login`'s `?error=` table with the success notices, using
   `Object.hasOwn` as the existing code does — a bare index would render a
   prototype function.
7. Specs for each form: submit path and error path.

## Success Criteria

- [x] All four routes load **signed out**, without redirecting to `/login`
- [x] A verification link opens `/verify-email` directly — the token is never
      copied into a `?next=` parameter
- [x] Register → verify → sign in works end to end against the console sender
- [x] Forgot → reset → sign in works end to end
- [x] A re-followed verification link says the account already exists
- [x] No token remains in `location.search` after mount
- [x] Registering signs nobody in
- [x] Web tests, lint, typecheck and `next build` pass

## Risk Assessment

**A page drifts from `/login`'s structure** — its own `Suspense` shape, its own
error table. Signal: two ways to render an auth error. Response: read
`app/login/page.tsx` first; its comments explain why it is shaped as it is.

**Rollback:** the routes are additive. Deleting the four directories and
reverting the `proxy.ts` matcher restores current behaviour exactly.
