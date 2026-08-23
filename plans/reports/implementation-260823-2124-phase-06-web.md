## Phase Implementation Report

### Executed Phase

- Phase: 6 — web auth pages
- Plan: `plans/260823-2053-auth-register-verify-reset-smtp/phase-06-web-auth-pages.md`
- Status: completed

### Files Modified

- `apps/web/proxy.ts` — matcher extended with `register$|register/|verify-email$|verify-email/|forgot-password$|forgot-password/|reset-password$|reset-password/`, same two-clause shape as `login`. Comment updated.
- `apps/web/src/clients/api-client.ts` — added `publicApi` (no `getHeaders`) + `register`, `verifyEmail`, `forgotPassword`, `resetPassword`, all validated against `authMessageSchema`.
- `apps/web/app/login/page.tsx` — added `SIGN_IN_NOTICES` table (`verified`/`reset`, same `Object.hasOwn` guard as `SIGN_IN_ERRORS`), renders `role="status"` notice; added `/forgot-password` and `/register` links below `LoginForm`.
- `apps/web/app/login/login-page.spec.tsx` — extended (not in the explicit file list, but is `page.tsx`'s co-located spec, already testing exactly this route) with tests for the new notices and links.

### Files Created

- `apps/web/app/register/page.tsx`, `app/verify-email/page.tsx`, `app/forgot-password/page.tsx`, `app/reset-password/page.tsx`
- `apps/web/src/components/auth/register-form.tsx` (+spec), `forgot-password-form.tsx` (+spec), `reset-password-form.tsx` (+spec), `verify-email-client.tsx` (+spec)
- `apps/web/src/proxy-matcher.spec.ts` — matcher regex test (placed under `src/`, not beside `proxy.ts`, because `vitest.config.ts`'s `include` glob only reaches `src/**` and `app/**`; a spec at the app root would be collected by nothing).

### Tasks Completed

- [x] Matcher exempts all four routes, `.+` still gates everything else (unit-tested)
- [x] Token-free `publicApi` client instance, no `getSession()` round trip
- [x] `/register`: mirrors `/login` exactly incl. signed-in redirect + `googleConfigured`/`Suspense` shape; 202 → fixed "check your email" notice; no auto sign-in
- [x] `/verify-email`: explicit click only (no auto-submit on mount, no GET side effect); token read once into state; `history.replaceState` strips query on mount; re-redemption (`message` contains "already exists") renders a `role="status"` notice + sign-in link instead of an error; fresh success → `/login?verified=1`
- [x] `/forgot-password`: confirmation text is a hardcoded string, never `data.message` — cannot vary with the API's (already-uniform) answer; a genuine transport/validation failure still surfaces as an error
- [x] `/reset-password`: same token-in-state + replaceState hygiene; success → `/login?reset=1`, no `finally` re-enabling the button (form is about to be replaced)
- [x] `/login`: `?verified=1`/`?reset=1` notices via `SIGN_IN_NOTICES` + `Object.hasOwn`; links to `/register` and `/forgot-password`
- [x] No new Referrer-Policy header added (relies on the existing global one, per plan instruction)
- [x] No new UI primitive; reused `Button`, `Input`, `Label`, `Card`
- [x] Specs: submit path + error path for all 4 forms, plus matcher exemption test and login-page notice/link tests

### Tests Status

- Type check: pass (`tsc --noEmit` — clean after `next typegen` regenerated route types for the new pages; typed-routes needs this once per new route dir, not part of `tsc` itself)
- Unit tests: pass — 348/348, 14 files
- Lint: pass (0 errors; 1 pre-existing warning in `theme-toggle-connected.tsx`, a file I did not touch)
- Build: pass — `next build` with `AUTH_SECRET` set; routes appear as `ƒ /register`, `ƒ /login` (both read `auth()`), `○ /forgot-password`, `○ /reset-password`, `○ /verify-email` (static)

Gate results:

```
pnpm --filter web test       -> PASS (348 passed, 0 failed)
pnpm --filter web typecheck  -> PASS
pnpm --filter web lint       -> PASS (0 errors, 1 pre-existing warning elsewhere)
pnpm --filter web build      -> PASS
```

### Issues Encountered

1. Typed routes: `next.config.ts` has `typedRoutes: true`; `tsc` initially failed on `<Link href="/register">`/`href="/forgot-password"` in `app/login/page.tsx` because `.next/types` predates these new route directories. Fixed by running `npx next typegen` once (regenerates route types without a full build) — this is a normal side effect of adding a route under typed routes, not a code defect; a real `next dev`/`next build` run regenerates it automatically too.
2. Test-harness bug (not app-code bug): my first pass at `register-form.spec.tsx` / `reset-password-form.spec.tsx` set `input.value = x` directly, then dispatched an `input` event. That does NOT reach a CONTROLLED input's React state — React overrides the DOM node's own `value` setter to track changes, so a bare assignment is invisible to it, and the resulting "input" event carries an unchanged value from React's point of view. Fixed by going through the native `HTMLInputElement.prototype.value` setter's `.call()` first (the standard RTL-less workaround), inlined per-call to avoid an `@typescript-eslint/unbound-method` lint error from storing the setter in a variable.
3. Unrelated pre-existing working-tree diffs found on `apps/web/next.config.ts` and `apps/web/src/components/layout/session-menu.tsx` (comment-only updates reflecting phase 5's password-reset revocation) — not touched by me, not part of this phase's file ownership; left as-is.

### Next Steps

None blocking. Phase 6 acceptance criteria all met and mechanically verified (proxy-matcher spec covers the exemption criterion explicitly).

Unresolved questions: none.
