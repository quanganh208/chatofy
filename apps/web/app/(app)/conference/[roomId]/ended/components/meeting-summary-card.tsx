'use client';

import { languageCodeSchema, type ConferenceDetailResponse } from '@chatofy/types';
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
    (p) => p.displayName?.trim() || t('web.conference.guest'),
  );
  // Codes become words only through the dictionary; a code outside the registry
  // has no name to show, so it is left out rather than printed raw.
  const languages = [...new Set(conference.participants.map((p) => p.sourceLanguage))]
    .map((code) => languageCodeSchema.safeParse(code))
    .flatMap((parsed) => (parsed.success ? [nameOf(parsed.data)] : []));

  const rows: [label: string, value: string][] = [
    [t('web.conference.summaryDuration'), formatDuration(conference, t)],
    [t('web.conference.participants'), names.join(', ') || '—'],
    [
      t('web.conference.summaryLanguages'),
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
 * From the first join to the owner ending it, rounded to the minute and never
 * shown as zero. A room with no recorded start or end says so instead of
 * guessing — the last participant leaving does not end a room.
 */
function formatDuration(conference: ConferenceDetailResponse, t: Translate): string {
  if (!conference.startedAt || !conference.endedAt) return t('web.conference.durationUnknown');
  const ms = Date.parse(conference.endedAt) - Date.parse(conference.startedAt);
  const total = Math.max(1, Math.round(ms / 60_000));
  if (total < 60) return t('web.conference.durationMinutes', { minutes: String(total) });
  return t('web.conference.durationHours', {
    hours: String(Math.floor(total / 60)),
    minutes: String(total % 60),
  });
}
