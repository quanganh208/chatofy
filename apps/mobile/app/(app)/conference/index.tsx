/**
 * Conference lobby: display name, language, a local camera preview, and two ways
 * into a call. "Create a room" asks `POST /conference` for a new room and opens
 * it; "Join a room" opens the id the user entered. Both navigate to `[roomId]`,
 * which runs the call. The one accent control here is Create; Join is outlined.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  PermissionsAndroid,
  Platform,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { mediaDevices, RTCView, MediaStream } from 'react-native-webrtc';
import { space, radius, fontSize, fontWeight } from '@chatofy/ui';
import { createTranslator, en } from '@chatofy/i18n';
import { conferenceRoomIdSchema } from '@chatofy/types/events';
import { useTheme } from '@/providers/theme-provider';
import { LanguagePicker, type SourceLanguage } from '@/components/conference/language-picker';
import { CreateConferenceRoomError, createConferenceRoom } from '@/conference/conference-rooms-api';

// English for now; device-locale selection is a follow-up.
const t = createTranslator(en);

export default function ConferenceLobbyScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  const [roomId, setRoomId] = useState('');
  const [displayName, setDisplayName] = useState('mobile-user');
  // The call screen reads `sourceLanguage` only at join, so it is chosen here in
  // the lobby and passed through as `lang`. Defaults to Vietnamese.
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>('vi');
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [creating, setCreating] = useState(false);
  const [lobbyError, setLobbyError] = useState<string | undefined>(undefined);
  const previewRef = useRef<MediaStream | null>(null);

  // Open a local camera preview so the user sees themselves before joining.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (Platform.OS === 'android') {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.CAMERA,
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        ]);
      }
      try {
        const stream = (await mediaDevices.getUserMedia({
          video: true,
          audio: false,
        })) as MediaStream;
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        previewRef.current = stream;
        setPreview(stream);
      } catch {
        // Preview is optional; the call screen requests media again and handles denial.
      }
    })();
    return () => {
      cancelled = true;
      previewRef.current?.getTracks().forEach((track) => track.stop());
      previewRef.current = null;
    };
  }, []);

  const openRoom = useCallback(
    (room: string) => {
      // Release the preview camera before the call screen opens its own.
      previewRef.current?.getTracks().forEach((track) => track.stop());
      previewRef.current = null;
      setPreview(null);
      router.push({
        pathname: '/(app)/conference/[roomId]',
        params: { roomId: room, displayName: displayName.trim(), lang: sourceLanguage },
      });
    },
    [displayName, sourceLanguage, router],
  );

  const onCreate = useCallback(async () => {
    if (!displayName.trim() || creating) return;
    setCreating(true);
    setLobbyError(undefined);
    try {
      const id = await createConferenceRoom();
      openRoom(id);
    } catch (err) {
      const notAuthenticated =
        err instanceof CreateConferenceRoomError && err.kind === 'not-authenticated';
      console.warn('[conference] create room failed', err);
      setLobbyError(
        notAuthenticated
          ? t('mobile.conference.notAuthenticated')
          : t('mobile.conference.createFailed'),
      );
    } finally {
      setCreating(false);
    }
  }, [displayName, creating, openRoom]);

  const onJoin = useCallback(() => {
    const room = roomId.trim();
    if (!room || !displayName.trim()) return;
    // Only an id `POST /conference` minted can name a room.
    if (!conferenceRoomIdSchema.safeParse(room).success) {
      setLobbyError(t('mobile.conference.roomNotFound'));
      return;
    }
    setLobbyError(undefined);
    openRoom(room);
  }, [roomId, displayName, openRoom]);

  const hasName = displayName.trim().length > 0;
  const canCreate = hasName && !creating;
  const canJoin = hasName && roomId.trim().length > 0 && !creating;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>
        {t('mobile.conference.lobbyTitle')}
      </Text>

      {preview ? (
        <RTCView streamURL={preview.toURL()} style={styles.preview} objectFit="cover" mirror />
      ) : (
        <View style={[styles.preview, styles.previewOff, { backgroundColor: colors.surface }]}>
          <Text style={{ color: colors.textSecondary, fontSize: fontSize.sm }}>
            {t('mobile.conference.cameraOff')}
          </Text>
        </View>
      )}

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          {t('mobile.conference.yourName')}
        </Text>
        <TextInput
          style={[
            styles.input,
            { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface },
          ]}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder={t('mobile.conference.yourNamePlaceholder')}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
        />
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          {t('mobile.conference.roomId')}
        </Text>
        <TextInput
          style={[
            styles.input,
            { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface },
          ]}
          value={roomId}
          onChangeText={(text) => {
            setRoomId(text);
            setLobbyError(undefined);
          }}
          placeholder={t('mobile.conference.roomIdPlaceholder')}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
        />
      </View>

      <LanguagePicker t={t} value={sourceLanguage} onChange={setSourceLanguage} locked={false} />

      {lobbyError ? (
        <Text style={[styles.label, { color: colors.textSecondary }]} accessibilityRole="alert">
          {lobbyError}
        </Text>
      ) : null}

      <TouchableOpacity
        style={[styles.start, { backgroundColor: canCreate ? colors.primary : colors.border }]}
        onPress={() => void onCreate()}
        disabled={!canCreate}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canCreate, busy: creating }}
      >
        <Text style={[styles.startText, { color: colors.primaryForeground }]}>
          {creating ? t('mobile.conference.creating') : t('mobile.conference.create')}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.start, styles.join, { borderColor: colors.border }]}
        onPress={onJoin}
        disabled={!canJoin}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canJoin }}
      >
        <Text style={[styles.startText, { color: canJoin ? colors.text : colors.muted }]}>
          {t('mobile.conference.join')}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    gap: space.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    marginBottom: space.sm,
  },
  preview: {
    width: '100%',
    height: 220,
    borderRadius: radius.md,
    marginBottom: space.sm,
  },
  previewOff: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: {
    gap: space.xs,
  },
  label: {
    fontSize: fontSize.sm,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: fontSize.base,
  },
  start: {
    borderRadius: radius.sm,
    paddingVertical: space.md,
    alignItems: 'center',
    marginTop: space.sm,
  },
  join: {
    borderWidth: 1,
    marginTop: 0,
  },
  startText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
});
