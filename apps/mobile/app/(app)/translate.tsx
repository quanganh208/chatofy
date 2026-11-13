/**
 * Live translation: one screen for every way a conversation can run. The source
 * picker decides it — a named source is a two-way conversation (vi↔en), Auto-detect
 * identifies each turn, and pairs with Chinese stay one-way. The server's answer
 * (`mode` on `server.session.ready`) is what the screen reports, not what it asked.
 *
 * Start is the screen's one accent control while no conversation runs. Leaving the
 * tab ends the conversation: nothing may keep listening to a phone nobody is looking at.
 */

import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { createTranslator, en } from '@chatofy/i18n';
import { AUTO_DETECT, type LanguageCode } from '@chatofy/types';
import { space } from '@chatofy/ui';
import { useHoldAccountPreferences } from '@/preferences/use-hold-account-preferences';
import { LanguageBar } from '@/components/translate/language-bar';
import { StatusStrip } from '@/components/translate/status-strip';
import { TranslateControls } from '@/components/translate/translate-controls';
import { TurnList } from '@/components/translate/turn-list';
import { VoiceSheet } from '@/components/translate/voice-sheet';
import { isRunning } from '@/translate/status-text';
import { turnRows } from '@/translate/turn-display';
import { asksTwoWay, normalizePair } from '@/translate/translate-mode';
import { withVoiceGender } from '@/translate/translate-settings';
import { useSaveConversation } from '@/translate/use-save-conversation';
import { useTranslateConversation } from '@/translate/use-translate-conversation';
import { useTranslateSettings } from '@/translate/use-translate-settings';
import { Screen } from '@/ui/components/screen';

const t = createTranslator(en);

export default function TranslateScreen() {
  const { settings, update } = useTranslateSettings();
  const conversation = useTranslateConversation();
  const { status, stop } = conversation;
  const save = useSaveConversation({
    status,
    conversation: conversation.conversation,
    identity: conversation.identity,
    pauses: conversation.pauses,
  });
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  // Switching tabs ends the conversation (and frees the microphone for a meeting).
  useFocusEffect(
    useCallback(() => {
      return () => stop();
    }, [stop]),
  );

  const running = isRunning(status);
  // A voice changed on another device waits for the next start, not the middle of a sentence.
  useHoldAccountPreferences(running);
  const pair = settings.pair;
  // The pair the transcript is read against is the one it STARTED with, not the picker's.
  const outputLanguage = conversation.identity?.pair.target ?? pair.target;

  const rows = turnRows(
    conversation.conversation.turns,
    conversation.conversation.displays,
    conversation.conversation.unheard,
    conversation.liveTurns,
    outputLanguage,
  );

  async function start() {
    if (starting) return;
    setStarting(true);
    try {
      await conversation.start(settings);
    } finally {
      setStarting(false);
    }
  }

  // Languages a translation may be spoken in: both sides of a two-way pair, else the output.
  const spokenLanguages: LanguageCode[] =
    asksTwoWay(pair) && pair.source !== AUTO_DETECT ? [pair.source, pair.target] : [pair.target];

  return (
    <Screen scroll={false} edges={['left', 'right']}>
      <LanguageBar
        pair={pair}
        locked={running}
        onChange={(next) => update((current) => ({ ...current, pair: normalizePair(next) }))}
      />

      <View style={styles.list}>
        <TurnList rows={rows} emptyText={t('web.translate.transcriptEmpty')} />
      </View>

      <StatusStrip
        status={status}
        level={conversation.level}
        error={conversation.error}
        identity={conversation.identity}
        languageMode={conversation.languageMode}
        save={save.state}
        onRetrySave={save.retry}
      />

      <TranslateControls
        status={status}
        starting={starting}
        speak={settings.speak}
        onSpeak={(speak) => update((current) => ({ ...current, speak }))}
        onVoice={() => setVoiceOpen(true)}
        onStart={() => void start()}
        onEnd={conversation.end}
        onPause={conversation.pause}
        onResume={conversation.resume}
      />

      <VoiceSheet
        visible={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        languages={spokenLanguages}
        voiceGender={settings.voiceGender}
        voices={settings.voices}
        onGender={(voiceGender) => update((current) => withVoiceGender(current, voiceGender))}
        onVoice={(language, token) =>
          update((current) => {
            const voices = { ...current.voices };
            if (token === undefined) delete voices[language];
            else voices[language] = token;
            return { ...current, voices };
          })
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, marginVertical: space.sm },
});
