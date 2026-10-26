import Link from 'next/link';
import { Button } from '@chatofy/ui/react';
import { getT } from '@/i18n/server';
import { Section } from './section';

/**
 * Video meetings, the half of the product the hero gives equal weight to.
 *
 * Four claims, each traceable: the link is the access for anyone signed in, each listener
 * hears every voice translated with subtitles, chat is translated per reader, and the end
 * screen offers minutes — the walkthrough in `docs/conference-demo-runbook.md` shows all
 * four. Nothing here mentions recording, because a meeting keeps no audio; that fact lives
 * in the privacy notice, where a reader looks for it.
 *
 * The scope line is the honesty line. Meetings translate between Vietnamese and English
 * only, while the translator also does Chinese, and a page that let the second fact stand
 * for the first would be promising a meeting the product cannot hold. It changes when the
 * meeting languages change.
 *
 * Items on the page ground, not cards: they are read and compared, not acted on as units.
 * The one action is an outline button: the section sits directly under the hero, whose
 * filled button is still in view, and the accent budget gives this section none.
 */
export async function Meetings() {
  const t = await getT();

  const points = (['Link', 'Hear', 'Chat', 'Minutes'] as const).map((point) => ({
    title: t(`web.landing.meetings${point}Title`),
    body: t(`web.landing.meetings${point}Body`),
  }));

  return (
    <Section
      id="meetings"
      title={t('web.landing.meetingsTitle')}
      description={t('web.landing.meetingsBody')}
    >
      <div className="grid gap-8 sm:grid-cols-2">
        {points.map((point) => (
          <div key={point.title} className="flex flex-col gap-2">
            <h3 className="text-body font-medium tracking-tight">{point.title}</h3>
            <p className="text-prose text-hint">{point.body}</p>
          </div>
        ))}
      </div>
      <div className="mt-10 flex flex-wrap items-center gap-4">
        <Button asChild variant="outline" className="rounded-full">
          <Link href="/conference">{t('web.landing.meetingsStart')}</Link>
        </Button>
        <p className="text-hint text-muted-foreground">{t('web.landing.meetingsScope')}</p>
      </div>
    </Section>
  );
}
