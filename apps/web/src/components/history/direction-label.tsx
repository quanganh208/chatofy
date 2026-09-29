'use client';

import type { LanguageCode } from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';

/**
 * Which way a stored conversation ran: drawn short, spoken in full.
 *
 * "Vietnamese → English" is 21 characters. Printed once per row it is the
 * loudest thing on a screen whose subject is the previews, so the visible text
 * is the short pair and the long one is carried for a screen reader — which also
 * spares it the arrow, a character no reader can be trusted to say usefully.
 *
 * Takes the two languages rather than a direction: naming is by registry code
 * (`web.languageName.<code>`, `web.languageShort.<code>`), not by one key per
 * direction, so a third language needs no new key here — only a new registry
 * entry.
 *
 * Shared by the list row and the detail header so the two cannot drift into
 * naming the same fact two different ways.
 */
export function DirectionLabel({ from, to }: { from: LanguageCode; to: LanguageCode }) {
  const t = useTranslate();

  return (
    <span className="whitespace-nowrap">
      <span aria-hidden>
        {t('web.history.directionShort', {
          from: t(`web.languageShort.${from}`),
          to: t(`web.languageShort.${to}`),
        })}
      </span>
      <span className="sr-only">
        {t('web.history.direction', {
          from: t(`web.languageName.${from}`),
          to: t(`web.languageName.${to}`),
        })}
      </span>
    </span>
  );
}
