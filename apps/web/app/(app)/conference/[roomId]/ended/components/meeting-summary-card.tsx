'use client';

import {
  conferenceDurationMinutes,
  languageCodeSchema,
  type ConferenceDetailResponse,
} from '@chatofy/types';
import type { Translate } from '@chatofy/i18n';
import { Card, CardContent } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { languageNamer } from '@/i18n/language-pair-labels';

/**
 * The end screen's summary card: how long the meeting ran, who was in it and
 * which languages it was held in.
 *
 * Readouts only, no action inside — it is a card because it is read as a unit,
 * and it is one of the end screen's two elevated surfaces (the minutes panel is
 * the other).
 */
export function MeetingSummaryCard({ conference }: { conference: ConferenceDetailResponse }) {
  const t = useTranslate();
  const nameOf = languageNamer(t);

  const names = conference.participants.map(
    (p) => p.displayName?.trim() || t('common.conference.guest'),
  );
  // Codes become words only through the dictionary; a code outside the registry
  // has no name to show, so it is left out rather than printed raw.
  const languages = [...new Set(conference.participants.map((p) => p.sourceLanguage))]
    .map((code) => languageCodeSchema.safeParse(code))
    .flatMap((parsed) => (parsed.success ? [nameOf(parsed.data)] : []));

  const rows: [label: string, value: string][] = [
    [t('common.conference.summaryDuration'), formatDuration(conference, t)],
    [t('common.conference.participants'), names.join(', ') || '—'],
    [
      t('common.conference.summaryLanguages'),
      (languages.length === 2 ? languages.join(' ↔ ') : languages.join(', ')) || '—',
    ],
  ];

  return (
    <Card>
      <CardContent>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/**
 * From the first join to the end of the meeting, rounded to the minute and never
 * shown as zero. The end is the owner ending the room or, as is usual — no client
 * ends rooms — the last participant leaving (`conferenceDurationMinutes`). While
 * someone is still in the room there is no end yet, and it says so.
 */
function formatDuration(conference: ConferenceDetailResponse, t: Translate): string {
  const total = conferenceDurationMinutes(conference);
  if (total === null) return t('common.conference.durationUnknown');
  if (total < 60) return t('common.conference.durationMinutes', { minutes: String(total) });
  return t('common.conference.durationHours', {
    hours: String(Math.floor(total / 60)),
    minutes: String(total % 60),
  });
}
