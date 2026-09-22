import type { Metadata } from 'next';
import { Be_Vietnam_Pro, Newsreader } from 'next/font/google';
import { AppSessionProvider } from '@/components/session-provider';
import { LocaleProvider } from '@/i18n/provider';
import { getLocale, getT } from '@/i18n/server';
import { serverEnv } from '@/config/server-env';
import { THEME_STORAGE_KEY } from '@/lib/theme';
import './globals.css';

/**
 * Self-hosted at build time rather than linked from Google, so the page pulls no
 * third-party request and cannot shift layout waiting for one.
 *
 * The popup cannot do any of this — `next/font` needs Next — so it declares the
 * same family from woff2 files it ships, built by
 * `apps/extension/scripts/build-fonts.mjs`. The two surfaces are held to one
 * family name by `src/design/token-parity.spec.ts`; nothing else could, because
 * the family this mints is a build-time hash that appears in no source file.
 */
const sans = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  // Be Vietnam Pro is a STATIC family, not variable, so `weight` is required and
  // omitting it fails the build. Four, matching what the components ask for:
  // body, control label, heading, and nothing heavier.
  weight: ['400', '500', '600', '700'],
  // NOT `--font-sans`. Tailwind v4 defines that name itself inside `@layer theme`,
  // and both declarations would have equal specificity — this one would survive
  // only because an unlayered rule beats a layered one, which is a source-order
  // accident waiting to be reordered. `globals.css` aliases `--font-sans` to this
  // in `@theme inline` instead, which is the supported way round.
  variable: '--font-be-vietnam',
  display: 'swap',
});

/**
 * The display face: page and section titles, the landing headline, the wordmark.
 * Nothing else — body, controls and every translation line stay in Be Vietnam Pro,
 * and the popup and overlay load no serif at all (the popup draws an outlined
 * wordmark instead).
 *
 * Declared AFTER `sans`, and the order matters: `token-parity.spec.ts` ties the
 * body family to the FIRST `next/font` call in this file.
 *
 * Variable, with the optical-size axis. Newsreader's `opsz` is what makes a 44px
 * headline and a 22px heading look drawn for their sizes; without it the display
 * sizes render with text-size spacing and look loose. Italic is loaded because the
 * hero's "Be heard" is set in it.
 */
const display = Newsreader({
  subsets: ['latin', 'vietnamese'],
  axes: ['opsz'],
  style: ['normal', 'italic'],
  variable: '--font-newsreader',
  display: 'swap',
});

/**
 * The tab, in the reader's language.
 *
 * `generateMetadata` rather than a static object, for the same reason every visible
 * string moved into the dictionary: a title is text a person reads. Static metadata
 * cannot await the cookie, so it would have pinned the tab to English on a fully
 * Vietnamese page — the one string nobody would think to check.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    // What `opengraph-image.png` and the icons resolve against. Unset, Next falls
    // back to localhost and warns — see `WEB_BASE_URL` in `server-env.ts`.
    metadataBase: new URL(serverEnv.WEB_BASE_URL),
    title: t('web.meta.home'),
    description: t('web.meta.homeDescription'),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  /*
    Resolved on the SERVER, and that is the difference from the theme below.
    A theme is one class attribute, so it can be applied after the fact by a script
    and the mismatch suppressed. A locale is the text content of the whole tree —
    resolve it in the browser and the server renders one language while hydration
    renders another.

    This awaits a cookie, which opts every route into dynamic rendering. Accepted and
    recorded in `i18n/server.ts`: the alternative is a URL prefix scheme, and one URL
    serving two languages is the right trade for a self-hosted thesis demo.
  */
  const locale = await getLocale();

  return (
    // No theme class from the server. Which ground the reader chose lives in their
    // browser, and the server renders the same HTML for everyone — so the class is
    // applied by the script below, before anything paints. `suppressHydrationWarning`
    // is the price: React would otherwise report the attribute it did not write.
    //
    // `lang` DOES come from the server, for the reason above — and it has to be
    // right: it is what a screen reader picks a voice from.
    <html lang={locale} className={`${sans.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        {/*
          Runs before the first paint, which is the whole point.
          Without it, someone who chose light on a dark machine sees a dark flash on
          every load — the markup arrives with no class, `color-scheme: light dark`
          resolves to the machine's answer, and the correction only lands once React
          has hydrated. No test catches that; it is only visible on reload.

          Kept to one statement and wrapped in try/catch: it runs before any error
          handling exists, and a throw here would leave the page unstyled rather than
          merely mis-themed. The storage key is the one value duplicated from
          `lib/theme.ts`, and a spec compares them.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var c=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(c==="light"||c==="dark")document.documentElement.classList.add(c)}catch(e){}`,
          }}
        />
      </head>
      <body>
        <LocaleProvider locale={locale}>
          <AppSessionProvider>{children}</AppSessionProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
