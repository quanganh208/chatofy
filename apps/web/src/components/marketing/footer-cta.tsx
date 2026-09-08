import Link from 'next/link';
import { Button } from '@chatofy/ui/react';
import { auth } from '@/../auth';
import { getT } from '@/i18n/server';
import { Section } from './section';
import { isLiveSession } from '@/lib/session-guard';

/**
 * The last thing on the page, and the second of the page's two filled buttons.
 *
 * Two is correct and the per-section budget is what keeps it at two: the hero owns one
 * and this owns one, and they are a viewport apart. A third — in "How it works", or in
 * "Where Chatofy runs" — is the sprawl that makes none of them read as the action.
 *
 * The body line is the honest version of a signup prompt: it names the two things
 * required and the one thing that is not.
 *
 * ## Nothing to accept, for someone who already has
 *
 * Signed in, this renders the heading and the line and no button. The page offers
 * `/translate` three times — the header, the hero, and here — which is a funnel
 * for a visitor without an account and three asks for something already done for
 * a visitor with one. The header was the only part that knew who was looking; the
 * hero and this one were hard links with no session awareness at all.
 *
 * The hero keeps its button on purpose. It is the page's subject, and a hero with
 * a headline and no action reads as a broken layout rather than as a page being
 * polite. Removing the LAST ask is what stops the repetition.
 */
export async function FooterCta() {
  const [t, session] = await Promise.all([getT(), auth()]);
  const signedIn = isLiveSession(session);

  return (
    <Section className="border-hairline mt-8 border-t text-center">
      <div className="flex flex-col items-center gap-4">
        <h2 className="text-title font-semibold tracking-tight text-balance">
          {t('web.landing.ctaTitle')}
        </h2>
        <p className="text-prose text-body max-w-prose">{t('web.landing.ctaBody')}</p>
        {signedIn ? null : (
          <Button asChild size="lg" className="mt-2">
            <Link href="/translate">{t('web.translate.startTranslating')}</Link>
          </Button>
        )}
      </div>
    </Section>
  );
}
