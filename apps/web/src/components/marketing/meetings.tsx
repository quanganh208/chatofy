import Link from 'next/link';
import { FileText, Link2, MessageSquare, Volume2 } from 'lucide-react';
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
 * The scope line is the honesty line: it names the languages a meeting translates between
 * (Vietnamese, English and Chinese), separately from what the translator does, so the page
 * never promises a meeting the product cannot hold. It changes when the meeting languages
 * change.
 *
 * Items on the page ground, not cards: they are read and compared, not acted on as units.
 * The one action is an outline button: the section sits directly under the hero, whose
 * filled button is still in view, and the accent budget gives this section none.
 */
export async function Meetings() {
  const t = await getT();

  const icons = { Link: Link2, Hear: Volume2, Chat: MessageSquare, Minutes: FileText } as const;
  const points = (['Link', 'Hear', 'Chat', 'Minutes'] as const).map((point) => ({
    Icon: icons[point],
    title: t(`web.landing.meetings${point}Title`),
    body: t(`web.landing.meetings${point}Body`),
  }));

  return (
    <Section
      id="meetings"
      title={t('web.landing.meetingsTitle')}
      description={t('web.landing.meetingsBody')}
    >
      {/* Flat tiles, not cards: no shadow, so the band adds nothing to the elevated-surface
          count of the page. */}
      <div className="grid gap-4 sm:grid-cols-2">
        {points.map((point) => (
          <div key={point.title} className="border-hairline flex gap-4 rounded-xl border p-5">
            <span
              aria-hidden
              className="bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
            >
              <point.Icon className="size-5" />
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <h3 className="text-body font-medium tracking-tight">{point.title}</h3>
              <p className="text-prose text-hint text-muted-foreground">{point.body}</p>
            </div>
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
