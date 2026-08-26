import Link from 'next/link';
import { Button } from '@chatofy/ui/react';
import { getT } from '@/i18n/server';
import { Section } from './section';

/**
 * The last thing on the page, and the second of the page's two filled buttons.
 *
 * Two is correct and the per-section budget is what keeps it at two: the hero owns one
 * and this owns one, and they are a viewport apart. A third — in "How it works", or in
 * "Where Chatofy runs" — is the sprawl that makes none of them read as the action.
 *
 * The body line is the honest version of a signup prompt: it names the two things
 * required and the one thing that is not.
 */
export async function FooterCta() {
  const t = await getT();

  return (
    <Section className="border-hairline mt-8 border-t text-center">
      <div className="flex flex-col items-center gap-4">
        <h2 className="text-title font-semibold tracking-tight text-balance">
          {t('web.landing.ctaTitle')}
        </h2>
        <p className="text-prose text-body max-w-prose">{t('web.landing.ctaBody')}</p>
        <Button asChild size="lg" className="mt-2">
          <Link href="/translate">{t('web.translate.startTranslating')}</Link>
        </Button>
      </div>
    </Section>
  );
}
