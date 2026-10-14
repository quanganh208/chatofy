/**
 * Conference lobby: pick a room + display name, preview the local camera, and join.
 * "Start" navigates to `[roomId]`, which runs the call. One accent control here is
 * Start; the fields and the preview are ground.
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
import { registerGlobals, mediaDevices, RTCView, MediaStream } from 'react-native-webrtc';
import { space, radius, fontSize, fontWeight } from '@chatofy/ui';
import { createTranslator, en } from '@chatofy/i18n';
import { useTheme } from '@/providers/theme-provider';

registerGlobals();

// English for now; device-locale selection is a follow-up (see the Phase 1 report).
const t = createTranslator(en);

export default function ConferenceLobbyScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  const [roomId, setRoomId] = useState('poc');
  const [displayName, setDisplayName] = useState('mobile-user');
  const [preview, setPreview] = useState<MediaStream | null>(null);
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

  const onStart = useCallback(() => {
    const room = roomId.trim();
    const name = displayName.trim();
    if (!room || !name) return;
    // Release the preview camera before the call screen opens its own.
    previewRef.current?.getTracks().forEach((track) => track.stop());
    previewRef.current = null;
    setPreview(null);
    router.push({
      pathname: '/(app)/conference/[roomId]',
      params: { roomId: room, displayName: name },
    });
  }, [roomId, displayName, router]);

  const canStart = roomId.trim().length > 0 && displayName.trim().length > 0;

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
          onChangeText={setRoomId}
          placeholder={t('mobile.conference.roomIdPlaceholder')}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
        />
      </View>

      <TouchableOpacity
        style={[styles.start, { backgroundColor: canStart ? colors.primary : colors.border }]}
        onPress={onStart}
        disabled={!canStart}
        activeOpacity={0.8}
        accessibilityRole="button"
      >
        <Text style={[styles.startText, { color: colors.primaryForeground }]}>
          {t('mobile.conference.start')}
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
  startText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
});
