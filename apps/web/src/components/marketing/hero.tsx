import Link from 'next/link';
import { Button, Card, CardContent } from '@chatofy/ui/react';
import { getT } from '@/i18n/server';

/**
 * The first screen: one claim, one action, and a look at the thing itself.
 *
 * **The visual is a real card, not a screenshot.** A screenshot goes stale the day
 * anything moves, renders at one theme in a page that has two, and cannot be read by
 * anyone using a screen reader. This is the product's own hierarchy drawn with the
 * product's own tokens: the translation at `text-translation` over the source at
 * `text-body`, exactly as `conversation-transcript.tsx` draws it. Getting that
 * relationship backwards here would teach the wrong thing before the reader arrives.
 *
 * Two controls, one of them filled. The secondary is a ghost anchor to the section
 * immediately below, which is where someone who is not ready to sign up actually wants
 * to go — and a second filled button would make the two look like the same offer.
 *
 * The status pill does NOT pulse. It pulses in the product because something is
 * genuinely happening; here it is a still life, and a dot animating forever beside
 * static text is the continuous motion the guidelines rule out.
 */
export async function Hero() {
  const t = await getT();

  return (
    <section className="grid items-center gap-12 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:py-24">
      <div className="flex flex-col gap-6">
        <h1 className="text-display max-w-[18ch] font-semibold tracking-tight text-balance">
          {t('web.landing.heroTitle')}
        </h1>
        <p className="text-prose text-body max-w-prose">{t('web.landing.heroBody')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href="/translate">{t('web.translate.startTranslating')}</Link>
          </Button>
          <Button asChild variant="ghost" size="lg">
            <a href="#how-it-works">{t('web.landing.heroSeeHow')}</a>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <span className="text-hint flex items-center gap-2 font-semibold">
              <span aria-hidden className="bg-live size-2 shrink-0 rounded-full" />
              {t('web.landing.demoListening')}
            </span>
          </div>
          <Turn source={t('web.landing.demoSourceOne')} target={t('web.landing.demoTargetOne')} />
          <div className="border-hairline border-t" />
          <Turn source={t('web.landing.demoSourceTwo')} target={t('web.landing.demoTargetTwo')} />
        </CardContent>
      </Card>
    </section>
  );
}

function Turn({ source, target }: { source: string; target: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground text-body">{source}</p>
      <p className="text-translation font-medium">{target}</p>
    </div>
  );
}
