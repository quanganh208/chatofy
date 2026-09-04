'use client';

import { Columns2, Rows3 } from 'lucide-react';
import { SegmentedControl } from '@chatofy/ui/react';
import type { TranslateSettings } from '@/lib/translate-settings';
import { useTranslate } from '@/i18n/provider';

/**
 * How the page is laid out, as opposed to how it sounds.
 *
 * One control today, and that is the honest size of it. The gear it opens behind
 * used to hold the voice as well, which put "what am I hearing" and "how is the
 * page arranged" behind one icon labelled neither — and left the reader to
 * discover that the speaker mark in the panel header, the thing actually about
 * sound, was not where sound was configured. The voice moved to that header; this
 * is what was left, and what a later page-level setting joins.
 *
 * Never disabled by `running`. Nothing here reaches the session — the layout is a
 * property of this browser, so it is the one group that stays fully live while
 * somebody is talking.
 */
export function DisplaySettingsPanel({
  value,
  onChange,
}: {
  value: TranslateSettings['transcriptLayout'];
  onChange: (transcriptLayout: TranslateSettings['transcriptLayout']) => void;
}) {
  const t = useTranslate();

  return (
    <SegmentedControl
      label={t('web.translate.transcript')}
      value={value}
      options={[
        {
          value: 'stacked',
          label: (
            <span className="flex items-center gap-1.5">
              <Rows3 aria-hidden className="size-4" /> {t('web.translate.transcriptStacked')}
            </span>
          ),
        },
        {
          value: 'columns',
          label: (
            <span className="flex items-center gap-1.5">
              <Columns2 aria-hidden className="size-4" /> {t('web.translate.transcriptColumns')}
            </span>
          ),
        },
      ]}
      onChange={onChange}
      hint={t('web.translate.transcriptHint')}
    />
  );
}
