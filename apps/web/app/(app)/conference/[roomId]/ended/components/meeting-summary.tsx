'use client';

import { conferenceDurationMinutes, type ConferenceDetailResponse } from '@chatofy/types';
import { meetingDuration, meetingLanguages, meetingParticipants } from '@chatofy/i18n';
import { useTranslate } from '@/i18n/provider';

/**
 * The end screen's summary: how long the meeting ran, who was in it and which
 * languages it was held in.
 *
 * Readouts only, no action inside, so it is not a card: three label–value rows on
 * the page ground, divided by hairlines.
 */
export function MeetingSummary({ conference }: { conference: ConferenceDetailResponse }) {
  const t = useTranslate();

  // Worded by `@chatofy/i18n` so the mobile end screen reads the same. The
  // duration runs from the first join to the end of the meeting — the owner
  // ending the room or, as is usual, the last participant leaving.
  const rows: [label: string, value: string][] = [
    [
      t('common.conference.summaryDuration'),
      meetingDuration(t, conferenceDurationMinutes(conference)),
    ],
    [
      t('common.conference.participants'),
      meetingParticipants(
        t,
        conference.participants.map((p) => p.displayName),
      ),
    ],
    [
      t('common.conference.summaryLanguages'),
      meetingLanguages(
        t,
        conference.participants.map((p) => p.sourceLanguage),
      ),
    ],
  ];

  return (
    <dl className="border-hairline divide-hairline divide-y border-t">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-6 py-3">
          <dt className="text-muted-foreground shrink-0">{label}</dt>
          <dd className="min-w-0 text-right tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
