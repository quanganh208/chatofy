'use client';

/**
 * Meeting end screen — where Leave and an owner-ended meeting land.
 *
 * Heading, the summary card (duration, participants, languages), Back to lobby,
 * then the room's minutes. The minutes are generated on demand, one stored copy
 * per room that any participant may (re)generate in their own language; the
 * panel is the same one `/translate` and history render.
 *
 * Design budget: Back to lobby is the ONE accent-filled control; Generate /
 * Regenerate is outline (`emphasis="quiet"`). Two elevated surfaces: the summary
 * card and the minutes panel. Every state is a row in accent-budget-app.spec.tsx.
 */

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@chatofy/ui/react';
import { conferenceRoomIdSchema } from '@chatofy/types/events';
import { useLocale, useTranslate } from '@/i18n/provider';
import { useConferenceEnd } from '@/hooks/use-conference-end';
import { MinutesPanel } from '@/components/translate/minutes-panel';
import { ACTIVE_CALL_KEY, decodeRoomId } from '../utils/room-route';
import { MeetingSummaryCard } from './components/meeting-summary-card';

export default function ConferenceEndedPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = decodeRoomId(params.roomId);

  // A meeting is over once this screen is up: nothing should bounce the user
  // back into it from the lobby, however they arrived here.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(ACTIVE_CALL_KEY);
      const active = raw ? (JSON.parse(raw) as { roomId?: unknown }) : null;
      if (active?.roomId === roomId) sessionStorage.removeItem(ACTIVE_CALL_KEY);
    } catch {
      sessionStorage.removeItem(ACTIVE_CALL_KEY);
    }
  }, [roomId]);

  // Only a server-minted cuid can name a room, so anything else is answered
  // without a request — the same rule the room screen applies.
  if (!conferenceRoomIdSchema.safeParse(roomId).success) {
    return <EndNotice messageKey="web.conference.endedNotFound" />;
  }
  return <EndScreen roomId={roomId} />;
}

function EndScreen({ roomId }: { roomId: string }) {
  const t = useTranslate();
  const locale = useLocale();
  const end = useConferenceEnd(roomId);

  if (end.load === 'loading') return <EndNotice messageKey="web.conference.endedLoading" />;
  if (end.load === 'not-found') return <EndNotice messageKey="web.conference.endedNotFound" />;
  if (end.load === 'failed' || !end.conference) {
    return <EndNotice messageKey="web.conference.endedLoadFailed" />;
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8">
      <h1 className="text-heading text-center font-semibold">{t('web.conference.endedTitle')}</h1>
      <MeetingSummaryCard conference={end.conference} />
      <BackToLobby />
      <MinutesPanel
        minutes={end.minutes}
        loading={end.generating}
        // A stored `failed` record is the last pass throwing, as much as a
        // request that failed just now.
        error={end.generateFailed || end.minutes?.status === 'failed'}
        canGenerate={end.conference._count.turns > 0}
        unavailableHint={t('web.conference.minutesNothingSaid')}
        emphasis="quiet"
        onGenerate={() => void end.generate(locale)}
      />
    </div>
  );
}

/** One line and the way out — loading, a room the caller was not in, a failed read. */
function EndNotice({
  messageKey,
}: {
  messageKey:
    | 'web.conference.endedLoading'
    | 'web.conference.endedNotFound'
    | 'web.conference.endedLoadFailed';
}) {
  const t = useTranslate();
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-body">{t(messageKey)}</p>
      <BackToLobby />
    </div>
  );
}

function BackToLobby() {
  const t = useTranslate();
  const router = useRouter();
  return (
    <Button variant="default" className="self-center" onClick={() => router.push('/conference')}>
      {t('web.conference.backToLobby')}
    </Button>
  );
}
