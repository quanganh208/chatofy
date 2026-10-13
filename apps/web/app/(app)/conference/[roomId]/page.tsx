'use client';

/**
 * In-call screen — Phase 2 product UI.
 *
 * Layout: video grid (center), control bar (bottom), participant roster
 * (collapsible side region). Loading/connecting/error states use tokens + i18n.
 *
 * Design budget: Leave is the ONE accent-filled control (variant="default").
 * Mic and camera toggles are outline. Zero elevated surfaces (the call screen
 * is the page ground; no cards). Registered in accent-budget-app.spec.tsx.
 */

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Users } from 'lucide-react';
import { Button } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { useConference } from '@/hooks/use-conference';
import { VideoGrid } from './components/video-grid';
import { ControlBar } from './components/control-bar';
import { ParticipantList } from './components/participant-list';

export default function ConferenceRoomPage() {
  const t = useTranslate();
  const router = useRouter();
  const params = useParams<{ roomId: string }>();
  const searchParams = useSearchParams();

  const roomId = decodeURIComponent(
    Array.isArray(params.roomId) ? (params.roomId[0] ?? '') : (params.roomId ?? ''),
  );
  const displayName = searchParams.get('name') ?? '';
  const sourceLanguage = searchParams.get('lang') ?? 'vi';

  const {
    status,
    localStream,
    peers,
    localMuted,
    localVideoEnabled,
    join,
    leave,
    toggleMute,
    toggleVideo,
  } = useConference(roomId, { displayName, sourceLanguage });

  // Auto-join once on mount. Ref guard prevents double-invoke in React Strict Mode.
  const joinedRef = useRef(false);
  useEffect(() => {
    if (joinedRef.current) return;
    joinedRef.current = true;
    void join();
    // join is a stable useCallback; deps intentionally empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Collapsible roster panel
  const [rosterOpen, setRosterOpen] = useState(true);

  function handleLeave() {
    leave();
    router.push('/conference');
  }

  // ── Connecting state ────────────────────────────────────────────────────────
  if (status === 'connecting' || status === 'idle') {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
        <p className="text-body text-textMuted">{t('web.conference.connecting')}</p>
        {/* Leave is still the one accent-filled control even in the loading state */}
        <Button variant="default" onClick={handleLeave}>
          {t('web.conference.leave')}
        </Button>
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
        <p className="text-body text-live">{t('web.conference.connecting')}</p>
        <Button variant="default" onClick={handleLeave}>
          {t('web.conference.leave')}
        </Button>
      </div>
    );
  }

  // ── In-call ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Room header */}
      <div className="border-border flex items-center justify-between border-b px-4 py-2">
        <span className="text-hint text-textMuted truncate">{roomId}</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setRosterOpen((o) => !o)}
          aria-label={rosterOpen ? t('web.conference.hideRoster') : t('web.conference.showRoster')}
          aria-pressed={rosterOpen}
        >
          <Users className="size-4" aria-hidden />
        </Button>
      </div>

      {/* Main area: grid + optional roster */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Video grid — takes all remaining horizontal space */}
        <main className="min-w-0 flex-1 overflow-y-auto p-3">
          <VideoGrid
            localStream={localStream}
            localLabel={displayName || t('web.conference.you')}
            localMuted={localMuted}
            localVideoEnabled={localVideoEnabled}
            peers={peers}
            waitingLabel={t('web.conference.waiting')}
          />
        </main>

        {/* Participant roster — collapsible side region, no card */}
        {rosterOpen && (
          <aside
            className="border-border w-52 shrink-0 overflow-y-auto border-l"
            aria-label={t('web.conference.rosterTitle')}
          >
            <ParticipantList
              selfName={displayName || t('web.conference.you')}
              selfMuted={localMuted}
              selfVideoEnabled={localVideoEnabled}
              selfLanguage={sourceLanguage}
              selfLabel={t('web.conference.you')}
              peers={peers}
              rosterTitle={t('web.conference.rosterTitle')}
            />
          </aside>
        )}
      </div>

      {/* Control bar — fixed at the bottom of the call screen */}
      <ControlBar
        localMuted={localMuted}
        localVideoEnabled={localVideoEnabled}
        onToggleMute={toggleMute}
        onToggleVideo={toggleVideo}
        onLeave={handleLeave}
        muteMicLabel={t('web.conference.muteMic')}
        unmuteMicLabel={t('web.conference.unmuteMic')}
        disableCameraLabel={t('web.conference.disableCamera')}
        enableCameraLabel={t('web.conference.enableCamera')}
        leaveLabel={t('web.conference.leave')}
      />
    </div>
  );
}
