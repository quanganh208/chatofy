import { NextResponse, type NextRequest } from 'next/server';
import { asLocale } from '@chatofy/i18n';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from '@/i18n/locale-cookie';
import { sameOriginPath } from '@/lib/same-origin-path';

/**
 * `GET /locale?lang=vi&next=/dashboard` — pin a language in a shareable link.
 *
 * **A route handler rather than the root layout, because App Router layouts receive no
 * `searchParams`.** They get `cookies()` and `headers()` and nothing else, so a
 * `?lang=` read there would compile, run, and silently do nothing. The other two
 * workarounds are worse: middleware would need exactly the matcher surgery the cookie
 * decision exists to avoid — `proxy.ts` deliberately excludes `/` and the auth routes —
 * and a client read-then-refresh reintroduces the language flash this phase bans.
 *
 * **`next` runs through `sameOriginPath`.** It is a redirect target taken from a query
 * string, which is precisely the open-redirect shape that helper was hardened for, and
 * a second check written here would be a second thing to get wrong. `?next=` pointing
 * off-origin lands on the default instead.
 *
 * An unsupported `lang` sets no cookie and still redirects. This URL is meant to be
 * pasted into a demo script or a slide; failing it loudly would break the demo over a
 * typo, and the reader still gets the page in whatever language they already had.
 *
 * 303 rather than 307: the browser should follow this with a GET regardless of what it
 * used here, and nothing about the destination depends on the method.
 */
export function GET(request: NextRequest) {
  const lang = asLocale(request.nextUrl.searchParams.get('lang'));
  const next = sameOriginPath(request.nextUrl.searchParams.get('next'));

  const response = NextResponse.redirect(new URL(next, request.nextUrl.origin), 303);
  if (lang) {
    response.cookies.set(LOCALE_COOKIE, lang, {
      path: '/',
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: 'lax',
      // Readable by the switcher, which writes the same cookie from the client so a
      // language change can keep the page's client state. See `locale-cookie.ts`.
      httpOnly: false,
    });
  }
  return response;
}
