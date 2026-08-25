import Link from 'next/link';
import { Button } from '@chatofy/ui/react';
import { auth } from '@/../auth';
import { getT } from '@/i18n/server';
import { cn } from '@/lib/utils';
import { Brand } from './brand';
import { MEASURE } from './measures';
import { ConnectedThemeToggle } from './theme-toggle-connected';
import { LocaleSwitcher } from './locale-switcher';
import { MarketingMenu, type MarketingMenuLink } from './marketing-menu';

/**
 * The public header.
 *
 * ## What a signed-in visitor sees
 *
 * One action, not two, and it points at `/dashboard` — the hub is what a returning
 * visitor wants, not the translator with no context around it. "Sign in" and "Get
 * started" both ask someone to do a thing they have already done, and offering them to a signed-in reader is the small tell that a
 * marketing page was written as if no one ever comes back. The session is read on the
 * SERVER, so the correct pair is in the first byte — a client check would render the
 * signed-out pair and swap it after hydration, which is a visible flicker on the one
 * page most likely to be someone's first impression.
 *
 * **`/` is not redirected for signed-in visitors, and must not be.** The landing page is
 * the shareable address and the one that opens the thesis demo; bouncing it to the app
 * would make it impossible to show. Being signed in changes the button, not the route.
 *
 * ## The section nav, arriving with its sections
 *
 * Three anchors, and each one now has an `id` to land on — `Section` in
 * `components/marketing/` owns them, so an anchor and its target are written in the same
 * change. That was the whole reason they waited: an anchor to a missing `id` fails the
 * way a dead nav item does, silently and only for the person who clicked it.
 *
 * The mobile sheet arrives with them for the same reason. A sheet holding two buttons
 * that already fit on a phone reveals nothing; a sheet holding three links that do not
 * fit is doing a job.
 *
 * `/` is the only marketing route, so the anchors are bare fragments rather than
 * `/#how-it-works`. If a second public page is ever added they have to become absolute,
 * or they will scroll that page looking for a section it does not have.
 */
export async function MarketingHeader() {
  const signedIn = (await auth()) !== null;
  const t = await getT();

  const links: readonly MarketingMenuLink[] = [
    { href: '#how-it-works', label: t('web.landing.howTitle') },
    { href: '#on-your-machine', label: t('web.landing.localTitle') },
    { href: '#where-it-runs', label: t('web.landing.surfacesTitle') },
  ];

  return (
    <header className="border-hairline bg-background sticky top-0 z-40 border-b">
      <div className={cn('mx-auto flex w-full items-center gap-4 px-6 py-4', MEASURE.marketing)}>
        <Brand />

        {/* Hidden below `md`, where the sheet carries the same three. Not duplicated
            markup with a media query each — one list, rendered twice. */}
        <nav aria-label={t('web.landing.navMenu')} className="hidden items-center gap-5 md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-hint text-prose hover:text-foreground focus-visible:ring-ring/50 rounded-sm font-medium focus-visible:ring-[3px] focus-visible:outline-none"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <LocaleSwitcher />
          <ConnectedThemeToggle />
          {signedIn ? (
            <Button asChild size="sm" className="hidden md:inline-flex">
              <Link href="/dashboard">{t('web.chrome.openApp')}</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
                <Link href="/login">{t('web.auth.signIn')}</Link>
              </Button>
              {/* The one accent-filled control on this screen. Everything else in the
                  header is ghost or a plain link, which is what makes this one read as
                  the action rather than as decoration. */}
              <Button asChild size="sm" className="hidden md:inline-flex">
                <Link href="/register">{t('web.chrome.getStarted')}</Link>
              </Button>
            </>
          )}
          <MarketingMenu
            links={links}
            title={t('web.landing.navMenu')}
            signedIn={signedIn}
            actions={{
              openApp: t('web.chrome.openApp'),
              signIn: t('web.auth.signIn'),
              getStarted: t('web.chrome.getStarted'),
            }}
          />
        </div>
      </div>
    </header>
  );
}
