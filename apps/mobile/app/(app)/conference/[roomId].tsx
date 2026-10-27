/**
 * Conference call view. Reads the room + display name from the route, drives
 * `useConferenceNative`, and renders the call-lifecycle state machine: connecting,
 * waiting (joined, alone), in-call, reconnecting, and the error/disconnected
 * dead-ends. The only accent control on this screen is Leave.
 *
 * Translation UX: a subtitle overlay on each speaking tile, a transcript sheet
 * accumulating the call's turns, the source language (chosen in the lobby and
 * shown locked here — the hook reads it at join and has no mid-call setter), and
 * the `translating…` badge on the local tile bound to `localTranslating`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { space, radius, fontSize, fontWeight } from '@chatofy/ui';
import { createTranslator, en } from '@chatofy/i18n';
import { toLanguageCode } from '@chatofy/types/domain';
import { useTheme } from '@/providers/theme-provider';
import { useConferenceNative, type PeerState } from '@/conference/use-conference-native';
import { VideoGrid } from '@/components/conference/video-grid';
import { CallControlBar } from '@/components/conference/call-control-bar';
import { ParticipantSheet } from '@/components/conference/participant-sheet';
import { TranscriptSheet, type TranscriptEntry } from '@/components/conference/transcript-sheet';
import { ChatPanel } from '@/components/conference/chat-panel';
import { LanguagePicker, type SourceLanguage } from '@/components/conference/language-picker';
import { getConferenceToken } from '@/conference/conference-token';
import {
  startMeetingForegroundService,
  stopMeetingForegroundService,
} from '../../../modules/meeting-foreground-service';

// English for now; device-locale selection is a follow-up.
const t = createTranslator(en);

/** Per-speaker accumulation state: the open entry and its turn, or null once it closes. */
type OpenEntries = Map<string, { id: string; turnId: string | undefined } | null>;

/**
 * Fold the peers' transient subtitles into an accumulating transcript.
 *
 * The hook replaces a turn's subtitle with each cumulative frame and clears it a
 * moment after the turn closes, so the only durable record is what the call view
 * captures as it sees each value. Frames of the same turn update the SAME entry
 * in place — one utterance is one line. A different turn id, or a cleared
 * caption, closes the entry, so the speaker's next turn starts a fresh line.
 */
function foldTranscript(
  peers: Map<string, PeerState>,
  prev: TranscriptEntry[],
  open: OpenEntries,
  seq: { n: number },
): { entries: TranscriptEntry[]; changed: boolean } {
  let changed = false;
  let next = prev;
  for (const [socketId, peer] of peers) {
    const text = peer.subtitle;
    const turnId = peer.subtitleTurnId;
    const current = open.get(socketId) ?? null;

    if (!text) {
      // Caption cleared → close the open entry so the next turn gets a new line.
      if (current !== null) open.set(socketId, null);
      continue;
    }

    if (current === null || current.turnId !== turnId) {
      // New turn for this speaker → append a fresh entry.
      const id = `${socketId}:${seq.n++}`;
      open.set(socketId, { id, turnId });
      next = next === prev ? [...prev] : next;
      next.push({ id, speaker: peer.displayName, text });
      changed = true;
    } else {
      // Same turn continuing → replace the open entry's text in place.
      const idx = next.findIndex((e) => e.id === current.id);
      if (idx >= 0 && next[idx].text !== text) {
        next = next === prev ? [...prev] : next;
        next[idx] = { ...next[idx], text, speaker: peer.displayName };
        changed = true;
      }
    }
  }
  return { entries: next, changed };
}

export default function ConferenceCallScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ roomId: string; displayName?: string; lang?: string }>();
  // The hook refuses an id that is not one `POST /conference` minted.
  const roomId = typeof params.roomId === 'string' ? params.roomId : '';
  const displayName =
    typeof params.displayName === 'string' && params.displayName.length > 0
      ? params.displayName
      : 'mobile-user';
  const initialLang: SourceLanguage =
    toLanguageCode(typeof params.lang === 'string' ? params.lang : '') ?? 'vi';

  const [sheetVisible, setSheetVisible] = useState(false);
  const [transcriptVisible, setTranscriptVisible] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>(initialLang);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const joinedRef = useRef(false);
  // Per-speaker open-entry id (null = closed), so partials of one turn collapse
  // to a single transcript line and a cleared caption starts the next line fresh.
  const openEntriesRef = useRef<OpenEntries>(new Map());
  // Monotonic counter for stable transcript entry ids.
  const seqRef = useRef({ n: 0 });

  const conference = useConferenceNative(roomId, {
    displayName,
    sourceLanguage,
    getToken: getConferenceToken,
  });

  const {
    status,
    errorReason,
    localStream,
    peers,
    localMuted,
    localVideoEnabled,
    localTranslating,
    translationEnded,
    reconnectAttempt,
    reconnectCap,
    mySocketId,
    messages,
    chatNotice,
    join,
    leave,
    toggleMute,
    toggleVideo,
    sendChat,
  } = conference;

  // Join once on mount. leave() runs on unmount via the cleanup below.
  useEffect(() => {
    if (joinedRef.current) return;
    joinedRef.current = true;
    void join();
    return () => {
      leave();
    };
    // join/leave are stable useCallbacks; intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Accumulate the transcript from each peer's current subtitle as it changes.
  useEffect(() => {
    const { entries, changed } = foldTranscript(
      peers,
      transcript,
      openEntriesRef.current,
      seqRef.current,
    );
    if (changed) setTranscript(entries);
    // transcript is read via closure and must not retrigger this effect on its own
    // set — only a peers change should fold again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peers]);

  // The language is fixed once a join is in flight; the picker is pre-join only.
  const languageLocked = status !== 'idle';

  // While a call is live, a foreground service keeps the microphone open in the
  // background (Android silences a backgrounded app's recordings otherwise). It
  // covers a reconnect too, so a network blip in the background does not cut it.
  const callLive = status === 'in-call' || status === 'reconnecting';
  useEffect(() => {
    if (!callLive) return;
    startMeetingForegroundService(
      t('mobile.conference.ongoingTitle'),
      t('mobile.conference.ongoingBody'),
    );
    return stopMeetingForegroundService;
  }, [callLive]);

  // A dead end (refused, not found, disconnected) goes back to the lobby.
  const onBackToLobby = useCallback(() => {
    leave();
    router.back();
  }, [leave, router]);

  // Leaving a call, or the owner ending it, lands on the end screen: the
  // meeting's summary and its minutes. `replace`, so Back does not re-enter it.
  const showEndScreen = useCallback(() => {
    router.replace({ pathname: '/conference/ended', params: { roomId, lang: sourceLanguage } });
  }, [router, roomId, sourceLanguage]);

  const onLeave = useCallback(() => {
    leave();
    showEndScreen();
  }, [leave, showEndScreen]);

  // Only someone who was IN the call: `room-ended` also answers a join to a room
  // that had already ended, and that visitor keeps the "meeting ended" notice.
  const wasInCallRef = useRef(false);
  useEffect(() => {
    if (status === 'in-call') wasInCallRef.current = true;
  }, [status]);
  useEffect(() => {
    if (errorReason === 'room-ended' && wasInCallRef.current) showEndScreen();
  }, [errorReason, showEndScreen]);

  const banner = useMemo(() => {
    if (status === 'connecting') return t('mobile.conference.connecting');
    if (status === 'reconnecting')
      return t('mobile.conference.reconnecting', { attempt: reconnectAttempt, cap: reconnectCap });
    if (status === 'in-call' && peers.size === 0) return t('mobile.conference.waiting');
    if (errorReason === 'audio-only') return t('mobile.conference.permissionDeniedAudioOnly');
    return undefined;
  }, [status, reconnectAttempt, reconnectCap, peers.size, errorReason]);

  // ─── Error / disconnected dead-ends ───────────────────────────────────────────
  if (status === 'error' || status === 'disconnected') {
    const title =
      errorReason === 'permission-denied'
        ? t('mobile.conference.permissionDenied')
        : errorReason === 'not-authenticated'
          ? t('mobile.conference.notAuthenticated')
          : errorReason === 'room-not-found'
            ? t('mobile.conference.roomNotFound')
            : errorReason === 'room-ended'
              ? t('mobile.conference.roomEnded')
              : status === 'disconnected'
                ? t('mobile.conference.disconnected')
                : t('mobile.conference.errorGeneric');
    const hint =
      errorReason === 'permission-denied'
        ? t('mobile.conference.permissionDeniedHint')
        : status === 'disconnected'
          ? t('mobile.conference.disconnectedHint')
          : undefined;

    return (
      <SafeAreaView
        style={[styles.container, styles.centered, { backgroundColor: colors.background }]}
      >
        <Text style={[styles.errorTitle, { color: colors.text }]}>{title}</Text>
        {hint ? (
          <Text style={[styles.errorHint, { color: colors.textSecondary }]}>{hint}</Text>
        ) : null}
        <TouchableOpacity
          style={[styles.backToLobby, { backgroundColor: colors.primary }]}
          onPress={onBackToLobby}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          <Text style={[styles.backToLobbyText, { color: colors.primaryForeground }]}>
            {t('mobile.conference.backToLobby')}
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {banner ? (
        <Text style={[styles.banner, { color: colors.textSecondary }]}>{banner}</Text>
      ) : null}
      {/* Translation ended for good: a readout in the banner's quiet style, no
          control — the call itself goes on untranslated. */}
      {translationEnded ? (
        <Text
          style={[styles.banner, { color: colors.textSecondary }]}
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
        >
          {t('mobile.conference.translationEnded')}
        </Text>
      ) : null}

      <ScrollView contentContainerStyle={styles.scroll}>
        <LanguagePicker
          t={t}
          value={sourceLanguage}
          onChange={setSourceLanguage}
          locked={languageLocked}
        />

        {localStream ? (
          <VideoGrid
            localStream={localStream}
            localLabel={`${displayName} · ${t('mobile.conference.you')}`}
            localMuted={localMuted}
            localVideoEnabled={localVideoEnabled}
            localTranslating={localTranslating}
            translatingLabel={t('mobile.conference.translating')}
            peers={peers}
          />
        ) : (
          <View style={styles.centered}>
            <Text style={{ color: colors.textSecondary }}>{t('mobile.conference.connecting')}</Text>
          </View>
        )}
      </ScrollView>

      <CallControlBar
        t={t}
        muted={localMuted}
        videoEnabled={localVideoEnabled}
        participantCount={peers.size + 1}
        onToggleMute={toggleMute}
        onToggleVideo={toggleVideo}
        onShowParticipants={() => setSheetVisible(true)}
        onLeave={onLeave}
      />

      <View style={styles.sheetButtons}>
        <TouchableOpacity
          style={[styles.sheetButton, { borderColor: colors.border }]}
          onPress={() => setTranscriptVisible(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <Text style={[styles.sheetButtonText, { color: colors.text }]}>
            {t('mobile.conference.showTranscript')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.sheetButton, { borderColor: colors.border }]}
          onPress={() => setChatVisible(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <Text style={[styles.sheetButtonText, { color: colors.text }]}>
            {t('mobile.conference.showChat')}
          </Text>
        </TouchableOpacity>
      </View>

      <ParticipantSheet
        t={t}
        visible={sheetVisible}
        localLabel={displayName}
        localMuted={localMuted}
        localVideoEnabled={localVideoEnabled}
        peers={peers}
        onClose={() => setSheetVisible(false)}
      />

      <TranscriptSheet
        t={t}
        visible={transcriptVisible}
        entries={transcript}
        onClose={() => setTranscriptVisible(false)}
      />

      <ChatPanel
        t={t}
        visible={chatVisible}
        messages={messages}
        mySocketId={mySocketId}
        onSend={sendChat}
        notice={chatNotice}
        onClose={() => setChatVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    gap: space.md,
    padding: space.lg,
  },
  banner: {
    textAlign: 'center',
    fontSize: fontSize.sm,
    paddingVertical: space.sm,
  },
  scroll: {
    padding: space.md,
    flexGrow: 1,
    gap: space.md,
  },
  sheetButtons: {
    flexDirection: 'row',
    gap: space.sm,
    marginHorizontal: space.md,
    marginBottom: space.sm,
  },
  sheetButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    alignItems: 'center',
  },
  sheetButtonText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
  errorTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
  },
  errorHint: {
    fontSize: fontSize.base,
    textAlign: 'center',
  },
  backToLobby: {
    borderRadius: radius.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
    alignItems: 'center',
  },
  backToLobbyText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
});
