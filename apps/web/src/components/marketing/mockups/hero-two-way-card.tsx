import { ArrowLeftRight } from 'lucide-react';
import { Card, CardContent } from '@chatofy/ui/react';
import type { Translate } from '@chatofy/i18n';
import { MockupChip, MockupTurn } from './mockup-parts';

/** A still microphone meter: bar heights in quarter-rems, drawn once, never animated. */
const METER = [2, 3, 5, 4, 6, 3, 5, 7, 4, 2, 3, 5, 3, 2];

/**
 * The hero's look at the product: a two-way conversation, drawn as the translator
 * draws one.
 *
 * Header: the pair, in the reader's own names for the two languages, with the "Both ways"
 * readout the translator shows under its source header. Body: two turns, each labelled
 * with the language it was spoken in through `web.translate.turnLanguage` — telling the
 * two apart on its own is half of what the page promises. Footer: the live dot and a
 * still meter. Nothing pulses: it is a still life, and a dot animating forever beside
 * static text is the continuous motion the guidelines rule out.
 *
 * The one Card on this stretch of the page. Everything else on the landing sits on the
 * page ground as hairline tiles, so this is the one elevated surface the first viewport
 * spends. Decorative as a whole (`aria-hidden`): the hero's copy says what it shows.
 */
export function HeroTwoWayCard({ t }: { t: Translate }) {
  const vi = t('common.languageName.vi');
  const en = t('common.languageName.en');

  return (
    <Card aria-hidden className="pointer-events-none relative select-none">
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <MockupChip>{vi}</MockupChip>
            <ArrowLeftRight className="text-muted-foreground size-3.5" />
            <MockupChip>{en}</MockupChip>
          </div>
          <span className="text-hint text-muted-foreground">{t('web.translate.modeTwoWay')}</span>
        </div>

        <div className="border-hairline border-t" />
        <MockupTurn
          label={t('web.translate.turnLanguage', { language: vi })}
          source={t('web.landing.demoSourceOne')}
          target={t('web.landing.demoTargetOne')}
        />
        <div className="border-hairline border-t" />
        <MockupTurn
          label={t('web.translate.turnLanguage', { language: en })}
          source={t('web.landing.demoSourceTwo')}
          target={t('web.landing.demoTargetTwo')}
        />

        <div className="bg-muted flex items-center gap-3 rounded-lg px-3 py-2.5">
          <span className="text-hint flex items-center gap-2 font-semibold">
            <span className="bg-live size-2 shrink-0 rounded-full" />
            {t('web.landing.demoListening')}
          </span>
          <span className="ml-auto flex h-7 items-center gap-0.5">
            {METER.map((height, index) => (
              <span
                key={index}
                className="bg-muted-foreground/60 w-1 rounded-full"
                style={{ height: `${height * 0.25}rem` }}
              />
            ))}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
