import Link from 'next/link';
import { Button, Card, CardContent } from '@chatofy/ui/react';
import { getT } from '@/i18n/server';
import { LotusIllustration } from './lotus-illustration';

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
 * Above it, the lotus: the brand mark grown into five dawn petals, which open once
 * and then stay still. It sits above the card and never under its text — the card is
 * opaque and the petals end where it begins.
 *
 * Two controls, one of them filled — the only filled control in the first viewport,
 * which is why the header's "Get started" is a quiet button. The secondary is a ghost
 * anchor to the section immediately below, which is where someone who is not ready to
 * sign up actually wants to go. The primary is a pill, as marketing buttons are;
 * app buttons keep the product radius.
 *
 * The status pill does NOT pulse. It pulses in the product because something is
 * genuinely happening; here it is a still life, and a dot animating forever beside
 * static text is the continuous motion the guidelines rule out.
 */
export async function Hero() {
  const t = await getT();

  return (
    <section className="grid items-center gap-12 py-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:py-24">
      <div className="flex flex-col gap-6">
        <h1 className="text-display font-display max-w-[16ch] font-light tracking-tight text-balance">
          <Headline
            title={t('web.landing.heroTitle')}
            emphasis={t('web.landing.heroTitleEmphasis')}
          />
        </h1>
        <p className="text-prose text-body max-w-prose">{t('web.landing.heroBody')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="lg" className="rounded-full">
            <Link href="/translate">{t('web.translate.startTranslating')}</Link>
          </Button>
          <Button asChild variant="ghost" size="lg" className="rounded-full">
            <a href="#how-it-works">
              {t('web.landing.heroSeeHow')}
              <span aria-hidden>→</span>
            </a>
          </Button>
        </div>
      </div>

      <div className="flex flex-col">
        <LotusIllustration className="mx-auto -mb-3 max-w-sm" />
        <Card className="relative">
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
      </div>
    </section>
  );
}

/**
 * The headline with its one italic phrase. The phrase is looked up rather than
 * marked up inside the string, so a translation that words it differently still
 * renders — upright, rather than with a stray marker in it.
 */
function Headline({ title, emphasis }: { title: string; emphasis: string }) {
  const at = emphasis ? title.indexOf(emphasis) : -1;
  if (at < 0) return title;
  return (
    <>
      {title.slice(0, at)}
      <em className="italic">{emphasis}</em>
      {title.slice(at + emphasis.length)}
    </>
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
