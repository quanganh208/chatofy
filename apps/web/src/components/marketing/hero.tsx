import Link from 'next/link';
import { dawn } from '@chatofy/ui';
import { Button } from '@chatofy/ui/react';
import { getT } from '@/i18n/server';
import { LotusIllustration } from './lotus-illustration';
import { HeroTwoWayCard } from './mockups/hero-two-way-card';

/**
 * The call apps the extension runs in. Product names, so they read the same in every
 * locale and are not dictionary strings; the list is the README's ("Browser extension").
 */
const CALL_APPS = ['Google Meet', 'Zoom', 'Facebook'] as const;

/**
 * The first screen: one claim, two actions, a look at the thing itself, and — under all
 * three — the two facts a visitor checks before reading anything else: which languages,
 * and where it works.
 *
 * **The visual is a real card, not a screenshot** — see `HeroTwoWayCard`. Above it, the
 * lotus: the brand mark grown into five dawn petals, which open once and then stay still.
 * It sits above the card and never under its text — the card is opaque and the petals end
 * where it begins.
 *
 * Two controls, because the page gives translation and meetings equal weight, but only
 * one of them filled: the accent budget allows one filled control per section, and the
 * header's "Get started" is quiet for the same reason. `/translate` takes the fill as the
 * thing a first-time visitor can try alone; `/conference` is the outline beside it. Both
 * are pills, as marketing buttons are; app buttons keep the product radius.
 *
 * The strip names each language in its own script (`common.language.*`), the way a
 * language menu does: a reader scanning for "Tiếng Việt" or "中文" finds it whatever the
 * interface language is. Its items are readouts, not links — nothing in it is a control.
 */
export async function Hero() {
  const t = await getT();

  const languages = [
    t('common.language.vietnamese'),
    t('common.language.english'),
    t('common.language.chinese'),
  ];
  const platforms = [t('web.landing.heroPlatformBrowser'), ...CALL_APPS];

  return (
    <section className="flex flex-col gap-12 pt-10 pb-12 lg:gap-16 lg:pt-20">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16">
        <div className="animate-rise-in flex flex-col gap-6 motion-reduce:animate-none">
          <h1 className="text-display font-display max-w-[16ch] font-light tracking-tight text-balance">
            <Headline
              title={t('web.landing.heroTitle')}
              emphasis={t('web.landing.heroTitleEmphasis')}
            />
          </h1>
          <p className="text-prose text-body max-w-prose">{t('web.landing.heroBody')}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="rounded-full">
              <Link href="/translate/one-way">{t('web.translate.startTranslating')}</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="rounded-full">
              <Link href="/conference">{t('web.landing.meetingsStart')}</Link>
            </Button>
          </div>
        </div>

        <div className="relative flex flex-col">
          {/* A dawn glow behind the lotus and the top of the card, never under a line of
              text: the card below is opaque and starts where the glow fades. */}
          <div
            aria-hidden
            className="animate-glow-drift pointer-events-none absolute inset-x-6 -top-6 h-64 rounded-[3rem] opacity-60 blur-3xl motion-reduce:animate-none dark:opacity-30"
            style={{
              backgroundImage: `linear-gradient(135deg, ${dawn.peach}, ${dawn.lavender}, ${dawn.mint})`,
            }}
          />
          <LotusIllustration className="relative mx-auto -mb-3 max-w-[18rem] sm:max-w-sm" />
          <HeroTwoWayCard t={t} />
        </div>
      </div>

      <dl className="border-hairline flex flex-col gap-4 border-t pt-6 lg:flex-row lg:items-center lg:gap-12">
        <StripGroup label={t('web.landing.heroLanguagesLabel')} items={languages} />
        <StripGroup label={t('web.landing.heroPlatformsLabel')} items={platforms} />
      </dl>
    </section>
  );
}

/** One labelled row of the strip: a term, then its values as quiet pills. */
function StripGroup({ label, items }: { label: string; items: readonly string[] }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <dt className="text-hint text-muted-foreground shrink-0 font-medium">{label}</dt>
      <dd className="flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={item}
            className="border-hairline text-hint text-foreground rounded-full border px-3 py-1 font-medium whitespace-nowrap"
          >
            {item}
          </span>
        ))}
      </dd>
    </div>
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
