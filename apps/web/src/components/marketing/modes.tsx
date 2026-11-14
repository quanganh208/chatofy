import Link from 'next/link';
import { FileText, Link2, MessageSquare, Volume2 } from 'lucide-react';
import { Button } from '@chatofy/ui/react';
import { getT } from '@/i18n/server';
import { Reveal } from '@/components/motion/reveal';
import { cn } from '@/lib/utils';
import { Section } from './section';
import { GlossaryMockup, HistoryMockup } from './mockups/library-mockups';
import { MeetingMockup } from './mockups/meeting-mockup';
import { OneWayMockup, TwoWayMockup } from './mockups/translate-mode-mockups';

/**
 * What Chatofy does, one tile per thing the app has a route for: meetings
 * (`/conference`), one-way and two-way translation (`/translate/one-way`, `/two-way`),
 * history (`/history`) and glossaries (`/glossary`). A bento, because the five are not
 * equal: meetings is half the product and gets the tall tile; the two translation modes
 * stack beside it; the library pair closes the grid.
 *
 * Every claim is the app's own. Two-way is "between Vietnamese and English for now"
 * because a two-way pair with Chinese cannot be told apart yet (`languages.ts`) and the
 * translator says so beside the picker. The meeting points are the four the conference
 * runbook walks through, and the scope line names the languages a meeting translates
 * between, so the page never promises a meeting the product cannot hold.
 *
 * Tiles on the page ground, hairline and shadowless: the hero card is the one elevated
 * surface near here. The one action is the outline "Create a meeting" — the hero's filled
 * button is a scroll away and the accent budget gives this section none. The mockups are
 * pictures (`mockup-parts.tsx`) and hold no controls.
 */
export async function Modes() {
  const t = await getT();

  const meetingIcons = { Link: Link2, Hear: Volume2, Chat: MessageSquare, Minutes: FileText };
  const meetingPoints = (['Link', 'Hear', 'Chat', 'Minutes'] as const).map((point) => ({
    Icon: meetingIcons[point],
    title: t(`web.landing.meetings${point}Title`),
    body: t(`web.landing.meetings${point}Body`),
  }));

  return (
    <Section
      id="modes"
      title={t('web.landing.modesTitle')}
      description={t('web.landing.modesBody')}
    >
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-12">
        <Reveal className="md:col-span-2 lg:col-span-7 lg:row-span-2">
          <Tile
            eyebrow={t('web.chrome.navConference')}
            title={t('web.landing.meetingsTitle')}
            body={t('web.landing.meetingsBody')}
            layout="flow"
          >
            <MeetingMockup t={t} />
            <ul className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {meetingPoints.map((point) => (
                <li key={point.title} className="flex gap-3">
                  <point.Icon
                    aria-hidden
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                  />
                  <div className="flex min-w-0 flex-col gap-1">
                    <h4 className="text-body font-medium tracking-tight">{point.title}</h4>
                    <p className="text-hint text-prose">{point.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-3 pt-2">
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/conference">{t('web.landing.meetingsStart')}</Link>
              </Button>
              <p className="text-hint text-muted-foreground">{t('web.landing.meetingsScope')}</p>
            </div>
          </Tile>
        </Reveal>

        <Reveal className="lg:col-span-5" delay={90}>
          <Tile
            eyebrow={t('web.translate.modeOneWay')}
            title={t('web.landing.modeOneWayTitle')}
            body={t('web.landing.modeOneWayBody')}
          >
            <OneWayMockup t={t} />
          </Tile>
        </Reveal>

        <Reveal className="lg:col-span-5" delay={180}>
          <Tile
            eyebrow={t('web.translate.modeTwoWay')}
            title={t('web.landing.modeTwoWayTitle')}
            body={t('web.landing.modeTwoWayBody')}
          >
            <TwoWayMockup t={t} />
          </Tile>
        </Reveal>

        <Reveal className="lg:col-span-7">
          <Tile
            eyebrow={t('web.chrome.navHistory')}
            title={t('web.landing.modeHistoryTitle')}
            body={t('web.landing.modeHistoryBody')}
            layout="split"
          >
            <HistoryMockup t={t} />
          </Tile>
        </Reveal>

        <Reveal className="lg:col-span-5" delay={90}>
          <Tile
            eyebrow={t('web.chrome.navGlossary')}
            title={t('web.landing.modeGlossaryTitle')}
            body={t('web.landing.modeGlossaryBody')}
          >
            <GlossaryMockup t={t} />
          </Tile>
        </Reveal>
      </div>
    </Section>
  );
}

/**
 * One bento tile: a small sentence-case eyebrow naming the part of the app, the heading,
 * the body, then its picture pushed to the bottom so tiles in a row align on their
 * mockups whatever their copy length. `split` sets text and picture side by side from
 * `lg`, for the wide History tile; at `md` it is a half-width tile and stacks. `flow`
 * keeps everything directly under the heading — the tall meetings tile, whose own last
 * row (its action) sits at the bottom instead.
 */
function Tile({
  eyebrow,
  title,
  body,
  layout = 'stack',
  children,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  layout?: 'stack' | 'split' | 'flow';
  children: React.ReactNode;
}) {
  const heading = (
    <div className="flex flex-col gap-2">
      <p className="text-hint text-muted-foreground font-medium">{eyebrow}</p>
      <h3 className="text-heading font-display tracking-tight text-balance">{title}</h3>
      {body ? <p className="text-prose text-body">{body}</p> : null}
    </div>
  );

  return (
    <div
      className={cn(
        'border-hairline flex h-full flex-col gap-5 rounded-2xl border p-6 lg:p-8',
        layout === 'split' && 'lg:grid lg:grid-cols-2 lg:items-center lg:gap-8',
      )}
    >
      {heading}
      {layout === 'stack' ? (
        <div className="mt-auto flex flex-col gap-5">{children}</div>
      ) : (
        children
      )}
    </div>
  );
}
