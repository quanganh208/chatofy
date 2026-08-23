import { describe, expect, it, vi } from 'vitest';

// `proxy.ts` imports `auth` from `@/../auth`, which validates `AUTH_SECRET` at
// module load — real for the running app, unavailable in a unit test. The
// matcher under test is a plain string on `config`, entirely independent of
// that call, so `auth` is stubbed rather than pulling in the real module.
//
// Placed under `src/` rather than beside `proxy.ts` at the app root: vitest's
// `include` glob only reaches `src/**` and `app/**` (see `vitest.config.ts`), so
// a spec sitting next to `proxy.ts` itself would be collected by nothing —
// passing by never running, the failure mode that reads most like success.
vi.doMock('@/../auth', () => ({ auth: (handler: unknown) => handler }));

const { config } = await import('../proxy');
const pattern = new RegExp(config.matcher[0]!);

/**
 * `proxy.ts:29-38` records why this is worth its own test: the exemption for
 * each new route has to use the same `name$|name/` two-clause shape `login`
 * does, and a bare prefix silently over-matches in a way that is easy to miss
 * by eye — `/registersomething` would pass a naive `register` exclusion.
 */
describe('the signed-out-redirect matcher', () => {
  it.each(['/register', '/verify-email', '/forgot-password', '/reset-password', '/login'])(
    'exempts %s from the gate',
    (path) => {
      expect(pattern.test(path)).toBe(false);
    },
  );

  it.each(['/register/', '/verify-email/', '/forgot-password/', '/reset-password/', '/login/'])(
    'exempts %s (trailing slash) from the gate',
    (path) => {
      expect(pattern.test(path)).toBe(false);
    },
  );

  it.each([
    '/translate',
    '/sessions/8f3a',
    '/registersomething',
    '/verify-emailx',
    '/forgot-passwordish',
    '/reset-passwords',
  ])('still gates %s', (path) => {
    expect(pattern.test(path)).toBe(true);
  });
});
