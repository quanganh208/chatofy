import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { Plan } from '@chatofy/types';
import { Button } from '@chatofy/ui/react';
import { getLocale, getT } from '@/i18n/server';
import { pricingContent } from '@/lib/pricing-content';
import { Section } from './section';

/**
 * What it costs, in one band, and the way to the full answer on `/pricing`.
 *
 * The number is the Free plan's monthly credits, and only that: it comes from the same
 * `Plan` rows `/pricing` reads (`GET /billing/plans`, through `pricingContent`), so the
 * landing cannot state an allowance the pricing page does not. When the plans could not
 * be loaded (`plans` is `null`) the number goes and everything else stays, as on
 * `/pricing` — a band that names no count is still true.
 *
 * The not-open notice is set as the same ruled paragraph `/pricing` uses, directly under
 * the explanation, because a price read before that sentence reads as an offer. There is
 * no buy button for the same reason; the one control is an outline link to `/pricing`,
 * and the accent budget holds this section at zero.
 */
export async function PricingTeaser({ plans }: { plans: Plan[] | null }) {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const free = pricingContent(t, locale, plans).bands.find((band) => band.id === 'free');

  return (
    <Section id="pricing">
      <div className="border-hairline grid gap-10 rounded-3xl border p-6 sm:p-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-center lg:gap-16 lg:p-14">
        <div className="flex flex-col gap-5">
          <h2 className="text-title font-display font-light tracking-tight text-balance">
            {t('web.landing.pricingTitle')}
          </h2>
          <p className="text-prose text-body max-w-prose">{t('web.landing.pricingBody')}</p>
          <p className="text-body text-foreground border-border max-w-prose border-l-2 pl-4 font-medium">
            {t('web.pricing.notOpen')}
          </p>
          <div>
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/pricing">
                {t('web.landing.pricingLink')}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
        {free?.summary ? (
          <div className="bg-muted flex flex-col gap-3 rounded-2xl p-6 sm:p-8">
            <p className="text-hint text-muted-foreground font-medium">{free.title}</p>
            <p className="text-heading font-display tracking-tight text-balance">{free.summary}</p>
          </div>
        ) : null}
      </div>
    </Section>
  );
}
