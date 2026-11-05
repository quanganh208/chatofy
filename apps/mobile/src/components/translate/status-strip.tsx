/**
 * Everything the screen has to say that is not the transcript: what the session is
 * doing, that a two-way start is running one way, an error, and whether the finished
 * conversation was saved. Lines of text on the ground, never cards.
 */

import { StyleSheet, Text, View } from 'react-native';
import { createTranslator, en } from '@chatofy/i18n';
import type { ConversationStatus } from '@chatofy/realtime-client';
import { space, fontSize } from '@chatofy/ui';
import { useTheme } from '@/providers/theme-provider';
import type { SaveState } from '@/translate/use-save-conversation';
import { languageNameKey, oneWayNotice, statusKey } from '@/translate/status-text';
import type {
  ConversationIdentity,
  LanguageModeAnswer,
  TranslateError,
} from '@/translate/use-translate-conversation';
import { GhostButton } from '@/ui/components/ghost-button';
import { InlineNotice } from '@/ui/components/inline-notice';

const t = createTranslator(en);

interface StatusStripProps {
  status: ConversationStatus;
  /** Microphone level, 0..1; drawn only while the microphone is open. */
  level: number;
  error: TranslateError | null;
  identity: ConversationIdentity | null;
  languageMode: LanguageModeAnswer | null;
  save: SaveState;
  onRetrySave: () => void;
}

export function StatusStrip({
  status,
  level,
  error,
  identity,
  languageMode,
  save,
  onRetrySave,
}: StatusStripProps) {
  const { colors } = useTheme();
  const notice = identity
    ? oneWayNotice(identity.pair, identity.askedTwoWay, languageMode?.mode ?? null)
    : null;
  const listening = status === 'listening' || status === 'hearing-speech';

  return (
    <View style={styles.box}>
      <Text
        style={[styles.status, { color: colors.textSecondary }]}
        accessibilityLiveRegion="polite"
      >
        {t(statusKey(status))}
      </Text>
      {listening ? (
        <View
          style={[styles.track, { backgroundColor: colors.border }]}
          accessibilityLabel={t('web.translate.micLevel')}
        >
          <View
            style={[
              styles.fill,
              {
                backgroundColor: colors.accent,
                width: `${Math.round(Math.min(1, Math.max(0, level)) * 100)}%`,
              },
            ]}
          />
        </View>
      ) : null}

      {notice ? (
        <InlineNotice
          message={t(notice.key, {
            from: t(languageNameKey(notice.from)),
            to: t(languageNameKey(notice.to)),
          })}
        />
      ) : null}

      {error ? (
        <InlineNotice tone="error" message={'key' in error ? t(error.key) : error.text} />
      ) : null}

      {save.phase === 'saving' ? <InlineNotice message={t('web.translate.saving')} /> : null}
      {save.phase === 'failed' ? (
        <>
          <InlineNotice
            tone="error"
            message={t(
              save.failure === 'retryable'
                ? 'web.translate.saveFailedRetryable'
                : 'web.translate.saveFailedTerminal',
            )}
          />
          {save.failure === 'retryable' ? (
            <GhostButton
              variant="outline"
              label={t('web.translate.saveRetry')}
              onPress={onRetrySave}
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.sm },
  status: { fontSize: fontSize.sm },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4 },
});
