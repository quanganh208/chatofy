'use client';

import type { LanguageCode } from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';

/**
 * Which language a turn was heard in, as a short muted tag — a readout beside the
 * speaker's name, never a control and never the accent. The tag is drawn short
 * ("EN") and said in full, the arrangement history rows use for the same fact.
 */
export function TurnLanguage({ languages }: { languages: readonly LanguageCode[] }) {
  const t = useTranslate();
  return (
    <span className="text-label text-muted-foreground" data-turn-language={languages.join(' ')}>
      <span aria-hidden>{languages.map((code) => t(`web.languageShort.${code}`)).join(' · ')}</span>
      <span className="sr-only">
        {t('web.translate.turnLanguage', {
          language: languages.map((code) => t(`common.languageName.${code}`)).join(', '),
        })}
      </span>
    </span>
  );
}
