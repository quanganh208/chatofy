'use client';

/**
 * In-call screen.
 *
 * Layout: video grid (center), control bar (bottom), participant roster and
 * chat (collapsible side region). Loading, error and ended states use tokens +
 * i18n.
 *
 * Design budget: Leave (or Back to lobby) is the ONE accent-filled control.
 * Mic and camera toggles are outline. Zero elevated surfaces (the call screen
 * is the page ground; no cards). Registered in accent-budget-app.spec.tsx.
 */

import { useEffect, useState } from 'react';
import type { Route } from 'next';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Users } from 'lucide-react';
import { Button } from '@chatofy/ui/react';
import { conferenceRoomIdSchema } from '@chatofy/types/events';
import { useTranslate } from '@/i18n/provider';
import { useConference } from '@/hooks/use-conference';
import { VideoGrid } from './components/video-grid';
import { ControlBar } from './components/control-bar';
import { ParticipantList } from './components/participant-list';
import { ChatPanel } from './components/chat-panel';
import { ACTIVE_CALL_KEY, decodeRoomId, endedPath } from './utils/room-route';

export default function ConferenceRoomPage() {
  const t = useTranslate();
  const router = useRouter();
  const params = useParams<{ roomId: string }>();
  const searchParams = useSearchParams();

  const roomId = decodeRoomId(params.roomId);
  const displayName = (searchParams.get('name') ?? '').trim();
  const sourceLanguage = searchParams.get('lang') === 'en' ? 'en' : 'vi';
  // A room id is a server-minted cuid; anything else can never name a room, so
  // it is answered here instead of with a socket round trip.
  const roomIdValid = conferenceRoomIdSchema.safeParse(roomId).success;

  const {
    status,
    errorReason,
    localStream,
    peers,
    mySocketId,
    localMuted,
    localVideoEnabled,
    audioBlocked,
    localTranslating,
    reconnectAttempt,
    reconnectCap,
    messages,
    chatRefusal,
    join,
    leave,
    toggleMute,
    toggleVideo,
    resumeAudio,
    sendChat,
  } = useConference(roomId, { displayName, sourceLanguage });

  // A shared link carries only the room: the name is asked for in the lobby,
  // with the room already filled in, and the lobby brings the user back here.
  useEffect(() => {
    if (!roomIdValid || displayName) return;
    const query = new URLSearchParams({ room: roomId, lang: sourceLanguage });
    router.replace(`/conference?${query.toString()}` as Route);
  }, [roomIdValid, displayName, roomId, sourceLanguage, router]);

  // Join on mount, leave on unmount. Leaving on unmount is what stops the
  // camera, the microphone and the translate session when the user navigates
  // away mid-call; the active-call key is kept so the lobby can bring them back.
  useEffect(() => {
    if (!roomIdValid || !displayName) return;
    sessionStorage.setItem(
      ACTIVE_CALL_KEY,
      JSON.stringify({ roomId, name: displayName, lang: sourceLanguage }),
    );
    void join();
    return leave;
    // Mount-only: the room and the name are fixed for the life of this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A room that is gone, or a call taken over by another tab, is not one to
  // bounce back into from the lobby.
  const callIsOver =
    !roomIdValid ||
    errorReason === 'room-not-found' ||
    errorReason === 'room-ended' ||
    errorReason === 'replaced';
  useEffect(() => {
    if (callIsOver) sessionStorage.removeItem(ACTIVE_CALL_KEY);
  }, [callIsOver]);

  // The owner ended the meeting: everyone still in it lands on the end screen,
  // the same place their own Leave would have taken them. `replace`, so Back
  // does not return to a room that refuses the join.
  const ownerEnded = errorReason === 'room-ended';
  useEffect(() => {
    if (ownerEnded) router.replace(endedPath(roomId));
  }, [ownerEnded, roomId, router]);

  // Collapsible roster panel
  const [rosterOpen, setRosterOpen] = useState(true);

  /** Out of the call and back to the lobby — for the states with no meeting to sum up. */
  function handleLeave() {
    sessionStorage.removeItem(ACTIVE_CALL_KEY);
    leave();
    router.push('/conference');
  }

  /**
   * Leave a call that was under way, to its end screen. `replace` rather than
   * `push`: Back would otherwise reopen this URL, and this screen joins on mount.
   */
  function handleLeaveCall() {
    sessionStorage.removeItem(ACTIVE_CALL_KEY);
    leave();
    router.replace(endedPath(roomId));
  }

  // ── The room does not exist, or its meeting is over — nothing to retry ────────
  if (!roomIdValid || errorReason === 'room-not-found' || errorReason === 'room-ended') {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-body font-medium">
          {errorReason === 'room-ended'
            ? t('web.conference.roomEnded')
            : t('web.conference.roomNotFound')}
        </p>
        <Button variant="default" onClick={handleLeave}>
          {t('web.conference.backToLobby')}
        </Button>
      </div>
    );
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

  // ── Reconnecting — transient WS drop, auto-retry in progress ────────────────
  if (status === 'reconnecting') {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-body text-textMuted">
          {t('web.conference.reconnecting', {
            attempt: String(reconnectAttempt),
            cap: String(reconnectCap),
          })}
        </p>
        {/* Leave stays the one accent-filled control in this transient state too */}
        <Button variant="default" onClick={handleLeave}>
          {t('web.conference.leave')}
        </Button>
      </div>
    );
  }

  // ── Permission denied — cannot join at all ──────────────────────────────────
  if (status === 'error' && errorReason === 'permission-denied') {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-body font-medium">{t('web.conference.permissionDenied')}</p>
        <p className="text-hint text-textMuted">{t('web.conference.permissionDeniedHint')}</p>
        <Button variant="default" onClick={handleLeave}>
          {t('web.conference.backToLobby')}
        </Button>
      </div>
    );
  }

  // ── WS disconnect / heartbeat eviction mid-call ──────────────────────────────
  if (status === 'disconnected') {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-body font-medium">{t('web.conference.disconnected')}</p>
        <p className="text-hint text-textMuted">{t('web.conference.disconnectedHint')}</p>
        <Button variant="default" onClick={handleLeave}>
          {t('web.conference.backToLobby')}
        </Button>
      </div>
    );
  }

  // ── Generic error state ─────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
        <p className="text-body text-live">{t('web.conference.errorGeneric')}</p>
        <Button variant="default" onClick={handleLeave}>
          {t('web.conference.backToLobby')}
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

      {/* Audio-only soft notice — no card, no elevation, inline text */}
      {errorReason === 'audio-only' && (
        <p className="text-hint text-textMuted border-border border-b px-4 py-1">
          {t('web.conference.permissionDeniedAudioOnly')}
        </p>
      )}

      {/* Audio blocked — browser autoplay policy suspended the TTS AudioContext.
          Ghost/readout control only; Leave is still the one accent-filled control. */}
      {audioBlocked && (
        <div className="border-border flex items-center justify-between border-b px-4 py-1">
          <p className="text-hint text-textMuted">{t('web.conference.audioBlocked')}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void resumeAudio();
            }}
          >
            {t('web.conference.enableAudio')}
          </Button>
        </div>
      )}

      {/* Main area: grid + optional roster */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Video grid — takes all remaining horizontal space */}
        <main className="min-w-0 flex-1 overflow-hidden p-2">
          <VideoGrid
            localStream={localStream}
            localLabel={displayName || t('web.conference.you')}
            localMuted={localMuted}
            localVideoEnabled={localVideoEnabled}
            peers={peers}
            waitingLabel={t('web.conference.waiting')}
            localTranslating={localTranslating}
            translatingLabel={t('web.conference.translating')}
          />
        </main>

        {/* Participant roster + chat — collapsible side region, flat (no cards) */}
        {rosterOpen && (
          <aside
            className="border-border flex w-52 shrink-0 flex-col overflow-hidden border-l"
            aria-label={t('web.conference.rosterTitle')}
          >
            <div className="shrink-0 overflow-y-auto">
              <ParticipantList
                selfName={displayName || t('web.conference.you')}
                selfMuted={localMuted}
                selfVideoEnabled={localVideoEnabled}
                selfLanguage={sourceLanguage}
                selfLabel={t('web.conference.you')}
                peers={peers}
                rosterTitle={t('web.conference.rosterTitle')}
              />
            </div>
            <div className="border-border mt-1 flex min-h-0 flex-1 flex-col border-t">
              <ChatPanel
                messages={messages}
                mySocketId={mySocketId}
                onSend={sendChat}
                title={t('web.conference.chatTitle')}
                inputPlaceholder={t('web.conference.chatPlaceholder')}
                sendLabel={t('web.conference.chatSend')}
                emptyLabel={t('web.conference.chatEmpty')}
                refusalLabel={
                  chatRefusal === 'rate-limited'
                    ? t('web.conference.chatRateLimited')
                    : chatRefusal === 'not-sent'
                      ? t('web.conference.chatNotSent')
                      : undefined
                }
              />
            </div>
          </aside>
        )}
      </div>

      {/* Control bar — fixed at the bottom of the call screen */}
      <ControlBar
        localMuted={localMuted}
        localVideoEnabled={localVideoEnabled}
        onToggleMute={toggleMute}
        onToggleVideo={toggleVideo}
        onLeave={handleLeaveCall}
        muteMicLabel={t('web.conference.muteMic')}
        unmuteMicLabel={t('web.conference.unmuteMic')}
        disableCameraLabel={t('web.conference.disableCamera')}
        enableCameraLabel={t('web.conference.enableCamera')}
        leaveLabel={t('web.conference.leave')}
      />
    </div>
  );
}
