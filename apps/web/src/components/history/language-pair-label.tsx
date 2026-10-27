'use client';

import { isAutoDetectConversation, type LanguageCode } from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';

/**
 * Which way a stored conversation ran: drawn short, spoken in full.
 *
 * "Vietnamese → English" is 21 characters. Printed once per row it is the
 * loudest thing on a screen whose subject is the previews, so the visible text
 * is the short pair and the long one is carried for a screen reader — which also
 * spares it the arrow, a character no reader can be trusted to say usefully.
 *
 * Takes the two languages rather than a pair: naming is by registry code
 * (`common.languageName.<code>`, `web.languageShort.<code>`), not by one key per
 * pair, so a third language needs no new key here — only a new registry
 * entry.
 *
 * Shared by the list row and the detail header so the two cannot drift into
 * naming the same fact two different ways.
 *
 * Takes the stored languages whole, because their COUNT is part of what they
 * say: more than two means the source was recognised turn by turn, stored
 * target first, so the row reads "Auto-detect → EN" rather than naming one of
 * the recognised languages as if it had been declared.
 */
export function LanguagePairLabel({ languages }: { languages: readonly LanguageCode[] }) {
  const t = useTranslate();
  const detected = isAutoDetectConversation(languages);
  // `conversationLanguagesSchema` guarantees at least two.
  const [first, second] = languages as [LanguageCode, LanguageCode];
  const to = detected ? first : second;
  const fromShort = detected ? t('web.history.autoDetect') : t(`web.languageShort.${first}`);
  const fromName = detected ? t('web.history.autoDetect') : t(`common.languageName.${first}`);

  return (
    <span className="whitespace-nowrap">
      <span aria-hidden>
        {t('web.history.languagePairShort', {
          from: fromShort,
          to: t(`web.languageShort.${to}`),
        })}
      </span>
      <span className="sr-only">
        {t('web.history.languagePair', {
          from: fromName,
          to: t(`common.languageName.${to}`),
        })}
      </span>
    </span>
  );
}
