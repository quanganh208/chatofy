import { ArrowRight, Mic } from 'lucide-react';
import type { Translate } from '@chatofy/i18n';
import { MockupChip, MockupFrame, MockupTurn } from './mockup-parts';

/**
 * One-way, drawn as `/translate/one-way` is: the pair picker above the turn — a declared
 * source and the language it is translated into — and a turn under it.
 *
 * English into Chinese on purpose. The hero shows Vietnamese and English; this is where
 * the third language appears in use, and a declared source is how Chinese is translated
 * (Auto-detect tells only Vietnamese and English apart, which the tile's copy says).
 */
export function OneWayMockup({ t }: { t: Translate }) {
  return (
    <MockupFrame>
      <div className="flex flex-wrap items-center gap-2">
        <MockupChip>{t('common.languageName.en')}</MockupChip>
        <ArrowRight className="text-muted-foreground size-3.5" />
        <MockupChip>{t('common.languageName.zh')}</MockupChip>
        <span className="text-hint text-muted-foreground ml-auto">
          {t('web.translate.modeOneWay')}
        </span>
      </div>
      <MockupTurn
        size="sm"
        source={t('web.landing.mockOneWaySource')}
        target={t('web.landing.mockOneWayTarget')}
      />
    </MockupFrame>
  );
}

/**
 * Two-way as two people see it: one turn from each side, each labelled with the language
 * it was spoken in, the second set to the far edge the way a reply is. The microphone
 * stays in the middle — one device, shared, which is the whole of this mode.
 */
export function TwoWayMockup({ t }: { t: Translate }) {
  const vi = t('common.languageName.vi');
  const en = t('common.languageName.en');

  return (
    <MockupFrame>
      <div className="mr-8 flex flex-col gap-1">
        <MockupTurn
          size="sm"
          label={t('web.translate.turnLanguage', { language: vi })}
          source={t('web.landing.mockTwoWaySourceOne')}
          target={t('web.landing.mockTwoWayTargetOne')}
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="border-hairline flex-1 border-t" />
        <span className="bg-muted text-foreground flex size-7 items-center justify-center rounded-full">
          <Mic className="size-3.5" />
        </span>
        <span className="border-hairline flex-1 border-t" />
      </div>
      <div className="ml-8 flex flex-col items-end gap-1 text-right">
        <MockupTurn
          size="sm"
          label={t('web.translate.turnLanguage', { language: en })}
          source={t('web.landing.mockTwoWaySourceTwo')}
          target={t('web.landing.mockTwoWayTargetTwo')}
        />
      </div>
    </MockupFrame>
  );
}
