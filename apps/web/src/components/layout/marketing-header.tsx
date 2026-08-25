import Link from 'next/link';
import { Button } from '@chatofy/ui/react';
import { auth } from '@/../auth';
import { getT } from '@/i18n/server';
import { cn } from '@/lib/utils';
import { Brand } from './brand';
import { MEASURE } from './measures';
import { ConnectedThemeToggle } from './theme-toggle-connected';

/**
 * The public header.
 *
 * ## What a signed-in visitor sees
 *
 * One action, not two. "Sign in" and "Get started" both ask someone to do a thing they
 * have already done, and offering them to a signed-in reader is the small tell that a
 * marketing page was written as if no one ever comes back. The session is read on the
 * SERVER, so the correct pair is in the first byte — a client check would render the
 * signed-out pair and swap it after hydration, which is a visible flicker on the one
 * page most likely to be someone's first impression.
 *
 * **`/` is not redirected for signed-in visitors, and must not be.** The landing page is
 * the shareable address and the one that opens the thesis demo; bouncing it to the app
 * would make it impossible to show. Being signed in changes the button, not the route.
 *
 * ## No section nav yet
 *
 * The mockup's header carries three anchors — how it works, runs on your machine, where
 * it runs — and they are not here, because the sections they point at do not exist until
 * the landing page is built. An anchor to a missing `id` fails the way a dead nav item
 * does, silently and only for the person who clicks it. They land with their sections,
 * and the mobile sheet lands with them: a sheet holding two buttons that already fit on
 * a phone is a control with nothing to reveal.
 */
export async function MarketingHeader() {
  const signedIn = (await auth()) !== null;
  const t = getT();

  return (
    <header className="border-hairline bg-background sticky top-0 z-40 border-b">
      <div className={cn('mx-auto flex w-full items-center gap-4 px-6 py-4', MEASURE.marketing)}>
        <Brand />
        <div className="ml-auto flex items-center gap-2">
          <ConnectedThemeToggle />
          {signedIn ? (
            <Button asChild size="sm">
              <Link href="/translate">{t('web.chrome.openApp')}</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">{t('web.auth.signIn')}</Link>
              </Button>
              {/* The one accent-filled control on this screen. Everything else in the
                  header is ghost or a plain link, which is what makes this one read as
                  the action rather than as decoration. */}
              <Button asChild size="sm">
                <Link href="/register">{t('web.chrome.getStarted')}</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
