/**
 * Conference call view. Reads the room + display name from the route, drives
 * `useConferenceNative`, and renders the call-lifecycle state machine: connecting,
 * waiting (joined, alone), in-call, reconnecting, and the error/disconnected
 * dead-ends. The only accent control on this screen is Leave.
 *
 * Phase 3 (translation UX): a subtitle overlay on each speaking tile, a transcript
 * sheet accumulating the call's turns, a source-language picker (pre-join only —
 * the hook reads `sourceLanguage` at join and has no mid-call setter), and the
 * `translating…` badge on the local tile bound to `localTranslating`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { space, radius, fontSize, fontWeight } from '@chatofy/ui';
import { createTranslator, en } from '@chatofy/i18n';
import { useTheme } from '@/providers/theme-provider';
import { useConferenceNative, type PeerState } from '@/conference/use-conference-native';
import { VideoGrid } from '@/components/conference/video-grid';
import { CallControlBar } from '@/components/conference/call-control-bar';
import { ParticipantSheet } from '@/components/conference/participant-sheet';
import { TranscriptSheet, type TranscriptEntry } from '@/components/conference/transcript-sheet';
import { ChatPanel } from '@/components/conference/chat-panel';
import { LanguagePicker, type SourceLanguage } from '@/components/conference/language-picker';
import { getConferenceToken } from '@/conference/conference-token';

// English for now; device-locale selection is a follow-up (see the Phase 1 report).
const t = createTranslator(en);

/** Per-speaker accumulation state: the open entry's id, or null once it closes. */
type OpenEntries = Map<string, string | null>;

/**
 * Fold the peers' transient subtitles into an accumulating transcript.
 *
 * The hook replaces a turn's subtitle on each partial and clears it to undefined
 * on final/timeout, so the only durable record is what the call view captures as
 * it sees each value. While a speaker has an open (non-empty) caption, each new
 * value updates the SAME entry in place — the partials of one turn collapse to a
 * single line. When the caption clears, the entry closes, so the speaker's next
 * caption starts a fresh line. This is the correct bound without touching the
 * hook: no turnId is exposed publicly, and the clear is what delimits a turn.
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
    const openId = open.get(socketId) ?? null;

    if (!text) {
      // Caption cleared → close the open entry so the next turn gets a new line.
      if (openId !== null) open.set(socketId, null);
      continue;
    }

    if (openId === null) {
      // New turn for this speaker → append a fresh entry.
      const id = `${socketId}:${seq.n++}`;
      open.set(socketId, id);
      next = next === prev ? [...prev] : next;
      next.push({ id, speaker: peer.displayName, text });
      changed = true;
    } else {
      // Same turn continuing → replace the open entry's text in place.
      const idx = next.findIndex((e) => e.id === openId);
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
  const roomId = typeof params.roomId === 'string' ? params.roomId : 'poc';
  const displayName =
    typeof params.displayName === 'string' && params.displayName.length > 0
      ? params.displayName
      : 'mobile-user';
  const initialLang: SourceLanguage = params.lang === 'en' ? 'en' : 'vi';

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
    reconnectAttempt,
    reconnectCap,
    mySocketId,
    messages,
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

  const onLeave = useCallback(() => {
    leave();
    router.back();
  }, [leave, router]);

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
          onPress={onLeave}
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
