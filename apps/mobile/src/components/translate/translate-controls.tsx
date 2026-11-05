/**
 * The controls under the transcript. Before a conversation (and after one ends)
 * Start is the screen's only accent-filled control; while it runs, End and Pause are
 * outlined, because ending is not what this screen exists for. The speak toggle and
 * the voice list are settings of the conversation, so they are locked once it runs:
 * the server decides whether to synthesize speech once, at start.
 */

import { StyleSheet, Switch, Text, View } from 'react-native';
import { createTranslator, en } from '@chatofy/i18n';
import type { ConversationStatus } from '@chatofy/realtime-client';
import { space, fontSize } from '@chatofy/ui';
import { useTheme } from '@/providers/theme-provider';
import { isRunning } from '@/translate/status-text';
import { GhostButton } from '@/ui/components/ghost-button';
import { PrimaryButton } from '@/ui/components/primary-button';

const t = createTranslator(en);

interface TranslateControlsProps {
  status: ConversationStatus;
  starting: boolean;
  speak: boolean;
  onSpeak: (speak: boolean) => void;
  onVoice: () => void;
  onStart: () => void;
  onEnd: () => void;
  onPause: () => void;
  onResume: () => void;
}

export function TranslateControls({
  status,
  starting,
  speak,
  onSpeak,
  onVoice,
  onStart,
  onEnd,
  onPause,
  onResume,
}: TranslateControlsProps) {
  const { colors } = useTheme();
  const running = isRunning(status);

  return (
    <View style={styles.box}>
      <View style={styles.settings}>
        <View style={styles.speak}>
          <Switch
            value={speak}
            onValueChange={onSpeak}
            disabled={running}
            trackColor={{ true: colors.primary, false: colors.border }}
            accessibilityLabel={t('web.translate.speakTranslationAria')}
          />
          <Text style={[styles.label, { color: running ? colors.muted : colors.text }]}>
            {t('web.translate.speakTranslation')}
          </Text>
        </View>
        <GhostButton
          variant="link"
          label={t('web.translate.voice')}
          onPress={onVoice}
          disabled={running || !speak}
        />
      </View>

      {running ? (
        <View style={styles.row}>
          <View style={styles.flex}>
            <GhostButton
              label={status === 'paused' ? t('web.translate.resume') : t('web.translate.pause')}
              onPress={status === 'paused' ? onResume : onPause}
              disabled={status === 'finishing' || status === 'connecting'}
            />
          </View>
          <View style={styles.flex}>
            <GhostButton
              label={t('web.translate.end')}
              onPress={onEnd}
              disabled={status === 'finishing'}
              destructive
            />
          </View>
        </View>
      ) : (
        <PrimaryButton
          label={t('web.translate.startConversation')}
          onPress={onStart}
          busy={starting}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.sm },
  settings: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  speak: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { fontSize: fontSize.base },
  row: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },
});
