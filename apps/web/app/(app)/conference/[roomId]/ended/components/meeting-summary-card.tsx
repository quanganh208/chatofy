'use client';

import { conferenceDurationMinutes, type ConferenceDetailResponse } from '@chatofy/types';
import { meetingDuration, meetingLanguages, meetingParticipants } from '@chatofy/i18n';
import { Card, CardContent } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';

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
