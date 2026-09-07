// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';

/**
 * Two things phase 4 could have broken here without failing anything else.
 *
 * **The Google gate.** Whether the button and its separator render is decided on
 * the server from THIS app's own configuration. A layout that always draws two
 * routes would show "or continue with email", and possibly a Google button, on a
 * deployment with no `AUTH_GOOGLE_ID` — the "button that errors, or a hidden one
 * that would have worked" outcome the page warns about twice. The separator is
 * the newer half of that risk: it is a label about a CHOICE, and a choice with
 * one option reads as a bug.
 *
 * **The `<Suspense>` boundary.** Both children call `useSearchParams` and both
 * must sit inside it. Phase 4 wrapped the form in a `Card`, which is exactly the
 * kind of edit that hoists a child out of a boundary by accident.
 *
 * Worth being exact about what this protects, because the page's own comment
 * used to overstate it: the route is ALREADY server-rendered on demand — the
 * `await auth()` at the top reads the session cookie, and `next build` reports
 * `ƒ /login` both before and after this work. So the boundary is not what keeps
 * the route static. It is what keeps the route buildable if it ever becomes
 * static again — Next fails a static render that reaches `useSearchParams` with
 * nothing above it — and that day arrives quietly, when someone moves the
 * signed-in check into middleware.
 */

const AUTH = { AUTH_SECRET: 'test-secret' };

/**
 * Everything the page is currently ANNOUNCING, with the markup stripped.
 *
 * Presence of `role="alert"` stopped being the question the moment the form's
 * message slot became permanent. It is drawn empty on purpose — a live region has
 * to exist before its content changes to be reported reliably, and a slot that
 * appears with its message also shifts the submit button under the pointer. So
 * these assertions ask what is being SAID, which is what they always meant.
 */
function alertText(html: string): string {
  return [...html.matchAll(/role="alert"[^>]*>(.*?)</g)]
    .map((match) => match[1] ?? '')
    .join('')
    .trim();
}

/** Import the page with Google configured or not, from a clean module graph. */
async function loadPage(
  googleConfigured: boolean,
  searchParams: { error?: string; next?: string; verified?: string; reset?: string } = {},
) {
  vi.resetModules();
  vi.doMock('@/config/server-env', () => ({
    serverEnv: AUTH,
    googleConfigured,
  }));
  vi.doMock('@/../auth', () => ({ auth: () => Promise.resolve(null) }));
  vi.doMock('next/navigation', () => ({
    redirect: () => {
      throw new Error('redirect should not run for a signed-out visitor');
    },
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  }));
  // `LoginForm` calls `signIn`, and this renders the page outside its layout, so
  // nothing else supplies next-auth. Stubbed as signed-out: this page is the one
  // surface a signed-out visitor sees.
  vi.doMock('next-auth/react', () => ({
    signIn: vi.fn(),
    signOut: vi.fn(),
    useSession: () => ({ data: undefined, status: 'unauthenticated' }),
  }));
  // `getT` resolves the locale from a cookie, and `cookies()` throws outside a
  // request. What this file is about is which branches the page renders, so the
  // English dictionary is handed over directly. The assertions below then read
  // from that same dictionary rather than restating it.
  vi.doMock('@/i18n/server', async () => {
    const { createTranslator, en } = await import('@chatofy/i18n');
    return { getT: () => Promise.resolve(createTranslator(en)) };
  });

  const { default: LoginPage } = await import('./page');
  const { LocaleProvider } = await import('@/i18n/provider');
  // Wrapped for the same reason `next-auth/react` is stubbed above: this renders
  // the PAGE, while the real tree always has `app/layout.tsx` around it. The
  // provider lives there, and `useTranslate` throws without one rather than
  // silently falling back — a subtree quietly rendering the wrong language is the
  // failure that would be worth catching in production, so it is not softened for
  // a test. No assertion below changes; the strings are the same English strings.
  return renderToStaticMarkup(
    <LocaleProvider>
      {await LoginPage({ searchParams: Promise.resolve(searchParams) })}
    </LocaleProvider>,
  );
}

afterEach(() => {
  vi.doUnmock('@/config/server-env');
  vi.doUnmock('@/../auth');
  vi.doUnmock('next/navigation');
  vi.doUnmock('next-auth/react');
  vi.doUnmock('@/i18n/server');
});

describe('the login page', () => {
  it('offers both routes when Google is configured', async () => {
    const html = await loadPage(true);
    expect(html).toContain('id="login-google"');
    expect(html).toContain(en['web.auth.orContinueWithEmail']);
    expect(html).toContain('id="login-submit"');
  });

  it('offers the email path alone when Google is not configured', async () => {
    const html = await loadPage(false);
    expect(html).not.toContain('id="login-google"');
    // The separator goes with it. A label naming a choice, above the only option
    // there is, is worse than no label.
    expect(html).not.toContain(en['web.auth.orContinueWithEmail']);
    expect(html).toContain('id="login-submit"');
  });

  it('keeps both search-param readers under a Suspense boundary', () => {
    // Read from the source rather than the render: `renderToStaticMarkup` resolves
    // Suspense away, so the rendered HTML cannot show whether the boundary is
    // there — and it is the boundary, not its output, that keeps the route static.
    // `import.meta.url` is a vite:// URL under this transformer, so the path is
    // resolved from the project root instead.
    // The `(auth)` segment is a route group: it shapes the file tree and the
    // layout that wraps this page, and does not appear in the URL. This path is a
    // FILE path, so it carries the group; the route is still `/login`.
    const source = readFileSync(resolve(process.cwd(), 'app/(auth)/login/page.tsx'), 'utf8');

    const boundary = source.indexOf('<Suspense');
    expect(boundary, 'the Suspense boundary is gone — the route silently de-opts').toBeGreaterThan(
      -1,
    );
    // Both readers must sit INSIDE it, not merely somewhere in the file.
    // `AuthDivider` is where `GoogleButton` lives now — the Google half and the
    // "or continue with email" line were copied verbatim into two pages, and the
    // search-param reader travels with them.
    for (const child of ['<AuthDivider', '<LoginForm']) {
      expect(source.indexOf(child), `${child} is outside the Suspense boundary`).toBeGreaterThan(
        boundary,
      );
    }
  });

  /**
   * `auth.ts` redirects here with `?error=google` OR `?error=server`, and tells
   * the two apart deliberately: one is about the user's account, the other is
   * about the server — most often Google login not being configured, which
   * answers 501. The page rendered only the first, so a server fault returned
   * the user to a bare form saying nothing at all, which reads as sign-in having
   * failed silently. Both values must produce a message, and it must be a
   * DIFFERENT one, or the distinction auth.ts pays for is thrown away here.
   */
  describe('the sign-in error banner', () => {
    it('explains a refusal about the account', async () => {
      const html = await loadPage(true, { error: 'google' });
      expect(html).toContain('role="alert"');
      expect(html).toContain(en['web.auth.googleRefused']);
    });

    it('explains a fault on the server without blaming the account', async () => {
      const html = await loadPage(true, { error: 'server' });
      expect(html).toContain('role="alert"');
      expect(html).toContain(en['web.auth.signInUnavailable']);
      // The account-refusal wording must not be what a server fault shows.
      expect(html).not.toContain(en['web.auth.googleRefused']);
    });

    it('stays silent when no error is carried', async () => {
      const html = await loadPage(true);
      expect(alertText(html), 'a banner appeared with nothing to report').toBe('');
    });

    /**
     * `error` is attacker-chosen — it arrives in the query string of a link
     * anyone can send. A bare index into the message table would answer
     * `?error=toString` with a function off Object's prototype, which React then
     * tries to render.
     */
    it('ignores a value that is only on the prototype chain', async () => {
      for (const error of ['toString', 'constructor', 'nope']) {
        const html = await loadPage(true, { error });
        expect(alertText(html), `?error=${error} rendered a banner`).toBe('');
      }
    });
  });

  it('uses the type scale for its heading, not a size name', async () => {
    const html = await loadPage(false);
    expect(html).toContain('text-title');
    expect(html).not.toMatch(/text-2xl|text-xl\b|text-lg\b/);
  });

  /**
   * `/verify-email` and `/reset-password` land here with `?verified=1` and
   * `?reset=1` after a real action completed elsewhere. A signed-out visitor
   * with no account of what just happened reads a bare form as that action
   * having silently failed — the same failure mode `SIGN_IN_ERRORS` above
   * exists to avoid for a refusal.
   */
  describe('the success notice', () => {
    it('confirms a redeemed verification link', async () => {
      const html = await loadPage(true, { verified: '1' });
      expect(html).toContain('role="status"');
      expect(html).toContain(en['web.auth.noticeVerified']);
    });

    it('confirms a completed password reset', async () => {
      const html = await loadPage(true, { reset: '1' });
      expect(html).toContain('role="status"');
      expect(html).toContain(en['web.auth.noticeReset']);
      // Not the verification wording — the two notices must stay distinct.
      expect(html).not.toContain(en['web.auth.noticeVerified']);
    });

    it('stays silent when neither flag is carried', async () => {
      const html = await loadPage(true);
      expect(html).not.toContain('role="status"');
    });

    it('ignores a value other than the literal "1"', async () => {
      for (const verified of ['0', 'true', 'toString']) {
        const html = await loadPage(true, { verified });
        expect(html, `?verified=${verified} rendered a notice`).not.toContain('role="status"');
      }
    });
  });

  it('links to registration and password recovery', async () => {
    const html = await loadPage(true);
    expect(html).toContain('href="/register"');
    expect(html).toContain('href="/forgot-password"');
  });
});
