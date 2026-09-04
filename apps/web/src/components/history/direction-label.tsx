'use client';

import type { TranslationDirection } from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';

/**
 * Which way a stored conversation ran: drawn short, spoken in full.
 *
 * "Vietnamese → English" is 21 characters. Printed once per row it is the
 * loudest thing on a screen whose subject is the previews, so the visible text
 * is the short pair and the long one is carried for a screen reader — which also
 * spares it the arrow, a character no reader can be trusted to say usefully.
 *
 * Shared by the list row and the detail header so the two cannot drift into
 * naming the same fact two different ways.
 */
export function DirectionLabel({ direction }: { direction: TranslationDirection }) {
  const t = useTranslate();
  const viToEn = direction === 'vi_to_en';

  return (
    <span className="whitespace-nowrap">
      <span aria-hidden>
        {t(viToEn ? 'web.history.directionShortViToEn' : 'web.history.directionShortEnToVi')}
      </span>
      <span className="sr-only">
        {t(viToEn ? 'web.history.directionViToEn' : 'web.history.directionEnToVi')}
      </span>
    </span>
  );
}
