'use client';

/**
 * Meeting end screen — where Leave and an owner-ended meeting land.
 *
 * Heading with Back to lobby beside it, the summary (duration, participants,
 * languages) as hairline rows, then the room's minutes. The minutes are generated
 * on demand, one stored copy per room that any participant may (re)generate in
 * their own language; the panel is the same one `/translate` and history render.
 * A pass the reader started ends in a toast — ready, or failed with Retry — while
 * the panel keeps its own inline state for whoever reads it later.
 *
 * Design budget: Back to lobby is the ONE accent-filled control; Generate /
 * Regenerate is outline (`emphasis="quiet"`). No elevated surface: everything sits
 * on the page ground, the minutes titled with an `h3` under the screen's `h2`.
 * Every state is a row in accent-budget-app.spec.tsx.
 */

import { useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@chatofy/ui/react';
import { conferenceRoomIdSchema } from '@chatofy/types/events';
import { useLocale, useTranslate } from '@/i18n/provider';
import { useConferenceEnd } from '@/hooks/use-conference-end';
import { MinutesPanel } from '@/components/translate/minutes-panel';
import { notify } from '@/lib/notify';
import { ACTIVE_CALL_KEY, decodeRoomId } from '../utils/room-route';
import { MeetingSummary } from './components/meeting-summary';

/** One toast per room's generation outcome: a retry replaces it rather than stacking. */
const MINUTES_TOAST = 'conference-minutes';

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
    return <EndNotice messageKey="common.conference.endedNotFound" />;
  }
  return <EndScreen roomId={roomId} />;
}

function EndScreen({ roomId }: { roomId: string }) {
  const t = useTranslate();
  const locale = useLocale();
  const end = useConferenceEnd(roomId);

  // Set when THIS reader presses Generate, so a stored `failed` record read on
  // arrival stays an inline line and never fires a toast nobody asked for.
  const requested = useRef(false);
  const { generating, generateFailed, generate } = end;
  useEffect(() => {
    if (generating || !requested.current) return;
    requested.current = false;
    if (generateFailed) {
      notify.error(t('web.conference.minutesFailedToast'), {
        id: MINUTES_TOAST,
        retry: () => {
          requested.current = true;
          void generate(locale);
        },
      });
    } else {
      notify.success(t('web.conference.minutesReady'), { id: MINUTES_TOAST });
    }
  }, [generating, generateFailed, generate, locale, t]);

  if (end.load === 'loading') return <EndNotice messageKey="common.conference.endedLoading" />;
  if (end.load === 'not-found') return <EndNotice messageKey="common.conference.endedNotFound" />;
  if (end.load === 'failed' || !end.conference) {
    return <EndNotice messageKey="common.conference.endedLoadFailed" />;
  }

  return (
    // The room routes are flush — a fixed-height frame that never scrolls — so this
    // screen scrolls itself, or long minutes would be cut off below the fold.
    <div className="flex min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-8 lg:py-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-title font-semibold tracking-tight">
            {t('common.conference.endedTitle')}
          </h2>
          <BackToLobby />
        </div>
        <MeetingSummary conference={end.conference} />
        <MinutesPanel
          minutes={end.minutes}
          loading={end.generating}
          // A stored `failed` record is the last pass throwing, as much as a
          // request that failed just now.
          error={end.generateFailed || end.minutes?.status === 'failed'}
          canGenerate={end.conference._count.turns > 0}
          unavailableHint={t('common.minutes.nothingSaid')}
          emphasis="quiet"
          titleAs="h3"
          onGenerate={() => {
            requested.current = true;
            notify.dismiss(MINUTES_TOAST);
            void generate(locale);
          }}
        />
      </div>
    </div>
  );
}

/** One line and the way out — loading, a room the caller was not in, a failed read. */
function EndNotice({
  messageKey,
}: {
  messageKey:
    | 'common.conference.endedLoading'
    | 'common.conference.endedNotFound'
    | 'common.conference.endedLoadFailed';
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
    <Button variant="default" onClick={() => router.push('/conference')}>
      {t('common.conference.backToLobby')}
    </Button>
  );
}
