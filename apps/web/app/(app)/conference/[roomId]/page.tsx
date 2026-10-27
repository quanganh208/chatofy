'use client';

/**
 * A room: the pre-join screen first, then the call.
 *
 * The URL is the room and nothing else, so it is what people share. Before
 * joining, `PreJoinStage` shows the camera and microphone, the name (from the
 * account), the spoken language and the translated voice; "Join now" is that
 * state's one accent. In the call: video grid (center), control bar (bottom),
 * participant roster and chat (collapsible side region).
 *
 * Design budget in the call: Leave (or Back to lobby) is the ONE accent-filled
 * control. Mic and camera toggles are outline. Zero elevated surfaces (the call
 * screen is the page ground; no cards). Registered in accent-budget-app.spec.tsx.
 */

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Link as LinkIcon, Users } from 'lucide-react';
import { Button } from '@chatofy/ui/react';
import type { LanguageCode } from '@chatofy/types';
import { conferenceRoomIdSchema } from '@chatofy/types/events';
import { useTranslate } from '@/i18n/provider';
import { languageNamer } from '@/i18n/language-pair-labels';
import { useConference } from '@/hooks/use-conference';
import { VideoGrid } from './components/video-grid';
import { ControlBar } from './components/control-bar';
import { ParticipantList } from './components/participant-list';
import { ChatPanel } from './components/chat-panel';
import { PreJoinStage, type PreJoinChoice } from './components/pre-join-stage';
import { ACTIVE_CALL_KEY, decodeRoomId, endedPath } from './utils/room-route';

/** The roster sits beside the grid from Tailwind's `md` up; below it, it covers the grid. */
const ROSTER_BESIDE_QUERY = '(min-width: 768px)';

export default function ConferenceRoomPage() {
  const t = useTranslate();
  const router = useRouter();
  const params = useParams<{ roomId: string }>();

  const roomId = decodeRoomId(params.roomId);
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
    translationEnded,
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
  } = useConference(roomId);

  // Who joined, once "Join now" was pressed. Null is the pre-join screen. The
  // hook leaves on unmount, which stops the camera, the microphone and the
  // translate session when the user navigates away mid-call; the active-call key
  // is kept so the landing can bring them back to this room.
  const [joinedAs, setJoinedAs] = useState<{ name: string; language: LanguageCode } | null>(null);

  function handleJoin(choice: PreJoinChoice) {
    // The hook starts unmuted with video on; match what the preview was left at.
    if (!choice.micOn) toggleMute();
    if (!choice.camOn) toggleVideo();
    sessionStorage.setItem(ACTIVE_CALL_KEY, JSON.stringify({ roomId }));
    setJoinedAs({ name: choice.displayName, language: choice.sourceLanguage });
    void join({
      displayName: choice.displayName,
      sourceLanguage: choice.sourceLanguage,
      devices: choice.devices,
    });
  }

  // "Copy invite link" says so for a moment, then goes quiet again.
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  function copyInviteLink() {
    void navigator.clipboard
      ?.writeText(`${window.location.origin}/conference/${encodeURIComponent(roomId)}`)
      .then(() => setCopied(true));
  }

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
  // does not return to a room that refuses the join. Only someone who was IN the
  // call: `room-ended` is also the answer to opening an old link to a room that
  // already ended, and that visitor gets "This meeting has ended" below, not an
  // end screen for a meeting they may never have joined.
  const wasInCall = useRef(false);
  useEffect(() => {
    if (status === 'in-call') wasInCall.current = true;
  }, [status]);
  const ownerEnded = errorReason === 'room-ended';
  useEffect(() => {
    if (ownerEnded && wasInCall.current) router.replace(endedPath(roomId));
  }, [ownerEnded, roomId, router]);

  // Collapsible roster panel: open beside the grid from `md` up, closed below it,
  // where it would cover the video. Follows the breakpoint when it is crossed
  // (a rotated tablet, a resized window); a tap in between still wins until then.
  const [rosterOpen, setRosterOpen] = useState(
    () => typeof window === 'undefined' || window.matchMedia(ROSTER_BESIDE_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(ROSTER_BESIDE_QUERY);
    const follow = (event: MediaQueryListEvent) => setRosterOpen(event.matches);
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);

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
            ? t('common.conference.roomEnded')
            : t('common.conference.roomNotFound')}
        </p>
        <p className="text-hint text-textMuted">{t('web.conference.roomGoneHint')}</p>
        <Button variant="default" onClick={handleLeave}>
          {t('common.conference.backToLobby')}
        </Button>
      </div>
    );
  }

  // ── Pre-join: not yet joined. `leave()` also reports 'idle', and Leave calls
  // it before navigating, so `joinedAs` is what keeps this screen from flashing
  // back (and reopening the camera) on the way out of a call. ─────────────────
  if (status === 'idle' && joinedAs === null) {
    return <PreJoinStage onJoin={handleJoin} />;
  }
  // Idle after joining is only ever the way out: Leave has called `leave()` and
  // the navigation is on its way. Nothing to show for that frame.
  if (status === 'idle') return null;

  // ── Connecting state ────────────────────────────────────────────────────────
  if (status === 'connecting') {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
        <p className="text-body text-textMuted">{t('common.conference.connecting')}</p>
        {/* Leave is still the one accent-filled control even in the loading state */}
        <Button variant="default" onClick={handleLeave}>
          {t('common.conference.leave')}
        </Button>
      </div>
    );
  }

  // ── Reconnecting — transient WS drop, auto-retry in progress ────────────────
  if (status === 'reconnecting') {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-body text-textMuted">
          {t('common.conference.reconnecting', {
            attempt: String(reconnectAttempt),
            cap: String(reconnectCap),
          })}
        </p>
        {/* Leave stays the one accent-filled control in this transient state too */}
        <Button variant="default" onClick={handleLeave}>
          {t('common.conference.leave')}
        </Button>
      </div>
    );
  }

  // ── Permission denied — cannot join at all ──────────────────────────────────
  if (status === 'error' && errorReason === 'permission-denied') {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-body font-medium">{t('common.conference.permissionDenied')}</p>
        <p className="text-hint text-textMuted">{t('web.conference.permissionDeniedHint')}</p>
        <Button variant="default" onClick={handleLeave}>
          {t('common.conference.backToLobby')}
        </Button>
      </div>
    );
  }

  // ── WS disconnect / heartbeat eviction mid-call ──────────────────────────────
  if (status === 'disconnected') {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-body font-medium">{t('common.conference.disconnected')}</p>
        <p className="text-hint text-textMuted">{t('common.conference.disconnectedHint')}</p>
        <Button variant="default" onClick={handleLeave}>
          {t('common.conference.backToLobby')}
        </Button>
      </div>
    );
  }

  // ── Generic error state ─────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
        <p className="text-body text-live">{t('common.conference.errorGeneric')}</p>
        <Button variant="default" onClick={handleLeave}>
          {t('common.conference.backToLobby')}
        </Button>
      </div>
    );
  }

  // ── In-call ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Room header */}
      <div className="border-border flex items-center justify-between border-b px-4 py-2">
        <p className="text-hint text-textMuted min-w-0 truncate">
          <span className="text-label mr-2 font-semibold uppercase tracking-wide">
            {t('web.conference.meetingCode')}
          </span>
          {roomId}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {copied && (
            <span role="status" className="text-hint text-textMuted">
              {t('web.conference.inviteLinkCopied')}
            </span>
          )}
          {/* Words from `sm` up, so the way to invite is found without hovering
              an icon; the phone keeps the icon and its accessible name. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={copyInviteLink}
            aria-label={t('web.conference.copyInviteLink')}
          >
            <LinkIcon className="size-4" aria-hidden />
            <span className="hidden sm:inline">{t('web.conference.copyInviteLink')}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setRosterOpen((o) => !o)}
            aria-label={
              rosterOpen ? t('common.conference.hideRoster') : t('web.conference.showRoster')
            }
            aria-pressed={rosterOpen}
          >
            <Users className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      {/* Audio-only soft notice — no card, no elevation, inline text */}
      {errorReason === 'audio-only' && (
        <p className="text-hint text-textMuted border-border border-b px-4 py-1">
          {t('common.conference.permissionDeniedAudioOnly')}
        </p>
      )}

      {/* Translation ended for good — a readout like the audio-only notice: no
          card, no control; the call itself goes on untranslated. */}
      {translationEnded && (
        <p
          role="status"
          data-translation-ended
          className="text-hint text-textMuted border-border border-b px-4 py-1"
        >
          {t('common.conference.translationEnded')}
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
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Video grid — takes all remaining horizontal space. A div, not <main>:
            the app chrome already renders the page's one main landmark. */}
        <div className="@container min-w-0 flex-1 overflow-hidden p-2">
          <VideoGrid
            localStream={localStream}
            localLabel={joinedAs?.name ?? t('common.conference.you')}
            localMuted={localMuted}
            localVideoEnabled={localVideoEnabled}
            peers={peers}
            waitingLabel={t('common.conference.waiting')}
            localTranslating={localTranslating}
            translatingLabel={t('common.conference.translating')}
          />
        </div>

        {/* Participant roster + chat — collapsible side region, flat (no cards) */}
        {rosterOpen && (
          <aside
            // Beside the grid from `md` up; below it, over the grid at full
            // width rather than squeezing the video into strips.
            className="border-border bg-background absolute inset-0 z-10 flex flex-col overflow-hidden md:static md:w-64 md:shrink-0 md:border-l xl:w-72"
            aria-label={t('common.conference.rosterTitle')}
          >
            <div className="shrink-0 overflow-y-auto">
              <ParticipantList
                selfName={joinedAs?.name ?? t('common.conference.you')}
                selfMuted={localMuted}
                selfVideoEnabled={localVideoEnabled}
                selfLanguage={languageNamer(t)(joinedAs?.language ?? 'vi')}
                selfLabel={t('common.conference.you')}
                peers={peers}
                rosterTitle={t('common.conference.rosterTitle')}
              />
            </div>
            <div className="border-border mt-1 flex min-h-0 flex-1 flex-col border-t">
              <ChatPanel
                messages={messages}
                mySocketId={mySocketId}
                onSend={sendChat}
                title={t('common.conference.chatTitle')}
                inputPlaceholder={t('common.conference.chatPlaceholder')}
                sendLabel={t('common.conference.chatSend')}
                emptyLabel={t('common.conference.chatEmpty')}
                refusalLabel={
                  chatRefusal === 'rate-limited'
                    ? t('common.conference.chatRateLimited')
                    : chatRefusal === 'not-sent'
                      ? t('common.conference.chatNotSent')
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
        muteMicLabel={t('common.conference.muteMic')}
        unmuteMicLabel={t('common.conference.unmuteMic')}
        disableCameraLabel={t('common.conference.disableCamera')}
        enableCameraLabel={t('common.conference.enableCamera')}
        leaveLabel={t('common.conference.leave')}
      />
    </div>
  );
}
