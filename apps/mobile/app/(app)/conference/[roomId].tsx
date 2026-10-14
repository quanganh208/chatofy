/**
 * Conference call view. Reads the room + display name from the route, drives
 * `useConferenceNative`, and renders the call-lifecycle state machine: connecting,
 * waiting (joined, alone), in-call, reconnecting, and the error/disconnected
 * dead-ends. The only accent control on this screen is Leave.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { space, radius, fontSize, fontWeight } from '@chatofy/ui';
import { createTranslator, en } from '@chatofy/i18n';
import { useTheme } from '@/providers/theme-provider';
import { useConferenceNative } from '@/conference/use-conference-native';
import { VideoGrid } from '@/components/conference/video-grid';
import { CallControlBar } from '@/components/conference/call-control-bar';
import { ParticipantSheet } from '@/components/conference/participant-sheet';
import { getConferenceToken } from '@/conference/conference-token';

// English for now; device-locale selection is a follow-up (see the Phase 1 report).
const t = createTranslator(en);

export default function ConferenceCallScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ roomId: string; displayName?: string }>();
  const roomId = typeof params.roomId === 'string' ? params.roomId : 'poc';
  const displayName =
    typeof params.displayName === 'string' && params.displayName.length > 0
      ? params.displayName
      : 'mobile-user';

  const [sheetVisible, setSheetVisible] = useState(false);
  const joinedRef = useRef(false);

  const conference = useConferenceNative(roomId, {
    displayName,
    sourceLanguage: 'vi',
    getToken: getConferenceToken,
  });

  const {
    status,
    errorReason,
    localStream,
    peers,
    localMuted,
    localVideoEnabled,
    reconnectAttempt,
    reconnectCap,
    join,
    leave,
    toggleMute,
    toggleVideo,
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
        {localStream ? (
          <VideoGrid
            localStream={localStream}
            localLabel={`${displayName} · ${t('mobile.conference.you')}`}
            localMuted={localMuted}
            localVideoEnabled={localVideoEnabled}
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

      <ParticipantSheet
        t={t}
        visible={sheetVisible}
        localLabel={displayName}
        localMuted={localMuted}
        localVideoEnabled={localVideoEnabled}
        peers={peers}
        onClose={() => setSheetVisible(false)}
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
