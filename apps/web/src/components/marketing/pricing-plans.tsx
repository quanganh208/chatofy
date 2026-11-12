import Link from 'next/link';
import { Button } from '@chatofy/ui/react';
import type { Plan } from '@chatofy/types';
import { dawn } from '@chatofy/ui';
import { auth } from '@/../auth';
import { Reveal } from '@/components/motion/reveal';
import { cn } from '@/lib/utils';
import { getLocale, getT } from '@/i18n/server';
import { pricingContent } from '@/lib/pricing-content';
import { isLiveSession } from '@/lib/session-guard';
import { Section } from './section';

/**
 * The top of `/pricing`: the title, the notice, what a credit is, and the one ask.
 *
 * **The notice comes first, directly under the title.** Chatofy is a non-commercial
 * thesis and only its owner's accounts can check out, so a price read before that
 * sentence reads as an offer to the reader. It is set as a ruled paragraph rather than
 * an `Alert`: an alert announces itself to a screen reader on load, and this is a fact
 * about the page, not an event.
 *
 * The page's only filled control is here. Signed out it is "Start free", which is true
 * of every account — Free needs no checkout. Signed in, that ask is already answered,
 * so it becomes the way back into the app, as the header's does.
 */
export async function PricingHero() {
  const [t, session] = await Promise.all([getT(), auth()]);
  const signedIn = isLiveSession(session);

  return (
    <section className="flex flex-col gap-6 py-16 lg:py-24">
      <h1 className="text-display font-display max-w-[16ch] font-light tracking-tight text-balance">
        {t('web.pricing.title')}
      </h1>
      <p className="text-body text-foreground border-border max-w-prose border-l-2 pl-4 font-medium">
        {t('web.pricing.notOpen')}
      </p>
      <p className="text-prose text-body max-w-prose">{t('web.pricing.intro')}</p>
      <div>
        <Button asChild size="lg" className="rounded-full">
          {signedIn ? (
            <Link href="/translate/one-way">{t('web.chrome.openApp')}</Link>
          ) : (
            <Link href="/register">{t('web.pricing.startFree')}</Link>
          )}
        </Button>
      </div>
    </section>
  );
}

/**
 * Free, Pro and the top-ups, side by side, then what a credit buys.
 *
 * Tiles on the page ground, not cards: the three are read and compared, and none is
 * acted on here — there is no buy button on a page whose checkout is not open, so the
 * plan bands spend no accent at all (`accent-budget.spec.tsx` holds them at zero).
 *
 * `plans` is `null` when the API could not be reached. The bands keep their names, lose
 * every number, and the page says the prices are unavailable rather than failing.
 */
export async function PricingPlans({ plans }: { plans: Plan[] | null }) {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const content = pricingContent(t, locale, plans);

  return (
    <Section id="plans" className="pt-0">
      {content.unavailable ? (
        <p role="status" className="text-body text-prose mb-8">
          {content.unavailable}
        </p>
      ) : null}
      <div className="grid gap-10 md:grid-cols-3 md:gap-8">
        {content.bands.map((band, index) => (
          <Reveal key={band.id} delay={index * 90}>
            <div
              className={cn(
                'border-hairline duration-base ease-standard hover:border-foreground/25 flex h-full flex-col gap-3 rounded-xl border p-6 transition hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0',
                band.id === 'pro' && 'border-foreground/20',
              )}
            >
              <span
                aria-hidden
                className="h-1 w-12 rounded-full"
                style={{
                  backgroundImage: `linear-gradient(90deg, ${dawn.peach}, ${dawn.lavender}, ${dawn.mint})`,
                }}
              />
              <h2 className="text-heading font-display tracking-tight">{band.title}</h2>
              {band.summary ? <p className="text-prose text-body">{band.summary}</p> : null}
              {band.lines.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {band.lines.map((line) => (
                    <li key={line} className="text-body text-foreground font-medium">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Reveal>
        ))}
      </div>
      <div className="mt-12 flex max-w-prose flex-col gap-2">
        {content.footnotes.map((note) => (
          <p key={note} className="text-hint text-muted-foreground">
            {note}
          </p>
        ))}
      </div>
    </Section>
  );
}
