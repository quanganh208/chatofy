/**
 * Meeting end screen — where Leave and an owner-ended meeting land.
 *
 * Heading, the summary card (duration, participants, languages), Back to lobby,
 * then the room's minutes: generated on demand, one stored copy per room that any
 * participant may (re)generate. Mobile writes them in the language the caller
 * spoke in the call (`lang`), since its UI has no locale of its own yet.
 *
 * Design budget, as on web: Back to lobby is the ONE accent-filled control;
 * Generate / Regenerate is outlined. Two surfaces: the summary card and the
 * minutes card.
 */

import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { space, radius, fontSize, fontWeight } from '@chatofy/ui';
import {
  createTranslator,
  en,
  meetingDuration,
  meetingLanguages,
  meetingParticipants,
  type MessageKey,
} from '@chatofy/i18n';
import {
  conferenceDurationMinutes,
  languageCodeSchema,
  type ConferenceDetailResponse,
  type ConferenceMinutes,
  type LanguageCode,
} from '@chatofy/types';
import { useTheme } from '@/providers/theme-provider';
import { useConferenceEnd } from '@/conference/use-conference-end';

// English for now, matching the conference screens; device-locale selection is a follow-up.
const t = createTranslator(en);

export default function ConferenceEndedScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ roomId?: string; lang?: string }>();
  const roomId = typeof params.roomId === 'string' ? params.roomId : '';
  const parsedLang = languageCodeSchema.safeParse(params.lang);
  const language: LanguageCode = parsedLang.success ? parsedLang.data : 'vi';
  const end = useConferenceEnd(roomId);

  let body: React.ReactNode;
  if (end.load === 'loading') {
    body = <Notice messageKey="common.conference.endedLoading" />;
  } else if (end.load === 'not-found') {
    body = <Notice messageKey="common.conference.endedNotFound" />;
  } else if (end.load === 'failed' || !end.conference) {
    body = <Notice messageKey="common.conference.endedLoadFailed" />;
  } else {
    body = (
      <>
        <SummaryCard conference={end.conference} />
        <BackToLobby />
        <MinutesCard
          minutes={end.minutes}
          generating={end.generating}
          failed={end.generateFailed || end.minutes?.status === 'failed'}
          canGenerate={end.conference._count.turns > 0}
          onGenerate={() => void end.generate(language)}
        />
      </>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={[styles.title, { color: colors.text }]}>
          {t('common.conference.endedTitle')}
        </Text>
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

/** One line and the way out — loading, a room the caller was not in, a failed read. */
function Notice({ messageKey }: { messageKey: MessageKey }) {
  const { colors } = useTheme();
  return (
    <>
      <Text style={[styles.notice, { color: colors.textSecondary }]}>{t(messageKey)}</Text>
      <BackToLobby />
    </>
  );
}

function BackToLobby() {
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <TouchableOpacity
      style={[styles.accent, { backgroundColor: colors.primary }]}
      // Back to the lobby already under this screen, not a second copy of it.
      onPress={() => router.dismissTo('/conference')}
      activeOpacity={0.8}
      accessibilityRole="button"
    >
      <Text style={[styles.accentText, { color: colors.primaryForeground }]}>
        {t('common.conference.backToLobby')}
      </Text>
    </TouchableOpacity>
  );
}

function SummaryCard({ conference }: { conference: ConferenceDetailResponse }) {
  const { colors } = useTheme();
  const rows: [string, string][] = [
    [
      t('common.conference.summaryDuration'),
      meetingDuration(t, conferenceDurationMinutes(conference)),
    ],
    [
      t('common.conference.participants'),
      meetingParticipants(
        t,
        conference.participants.map((p) => p.displayName),
      ),
    ],
    [
      t('common.conference.summaryLanguages'),
      meetingLanguages(
        t,
        conference.participants.map((p) => p.sourceLanguage),
      ),
    ],
  ];
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>{label}</Text>
          <Text style={[styles.rowValue, { color: colors.text }]}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function MinutesCard({
  minutes,
  generating,
  failed,
  canGenerate,
  onGenerate,
}: {
  minutes: ConferenceMinutes | null;
  generating: boolean;
  failed: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
}) {
  const { colors } = useTheme();
  const ready = minutes?.status === 'ready' ? minutes : null;

  let state: React.ReactNode = null;
  if (generating) {
    state = (
      <View style={styles.inline}>
        <ActivityIndicator color={colors.textSecondary} />
        <Text style={{ color: colors.textSecondary }}>
          {t('mobile.conference.minutesGenerating')}
        </Text>
      </View>
    );
  } else if (!canGenerate) {
    state = <Text style={{ color: colors.textSecondary }}>{t('common.minutes.nothingSaid')}</Text>;
  } else if (failed) {
    state = <Text style={{ color: colors.destructive }}>{t('common.minutes.failed')}</Text>;
  } else if (!ready) {
    state = (
      <Text style={{ color: colors.textSecondary }}>{t('mobile.conference.minutesEmpty')}</Text>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.cardTitle, { color: colors.text }]}>{t('common.minutes.title')}</Text>
      {state}
      {ready && !generating ? <MinutesContent minutes={ready} /> : null}
      {canGenerate ? (
        <TouchableOpacity
          style={[styles.outline, { borderColor: colors.border }, generating && styles.disabled]}
          onPress={onGenerate}
          disabled={generating}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ disabled: generating, busy: generating }}
        >
          <Text style={[styles.outlineText, { color: colors.text }]}>
            {ready ? t('common.minutes.regenerate') : t('common.minutes.generate')}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function MinutesContent({ minutes }: { minutes: ConferenceMinutes }) {
  const { colors } = useTheme();
  const heading = (key: MessageKey) => (
    <Text style={[styles.sectionHeading, { color: colors.textSecondary }]}>{t(key)}</Text>
  );
  const bullets = (items: string[]) =>
    items.map((item, i) => (
      <Text key={i} style={[styles.bullet, { color: colors.text }]}>
        • {item}
      </Text>
    ));

  return (
    <View style={styles.sections}>
      {heading('common.minutes.summary')}
      <Text style={{ color: colors.text }}>{minutes.summary}</Text>
      {minutes.keyPoints.length > 0 ? (
        <>
          {heading('common.minutes.keyPoints')}
          {bullets(minutes.keyPoints)}
        </>
      ) : null}
      {minutes.decisions.length > 0 ? (
        <>
          {heading('common.minutes.decisions')}
          {bullets(minutes.decisions)}
        </>
      ) : null}
      {heading('common.minutes.actionItems')}
      {minutes.actionItems.length === 0 ? (
        <Text style={{ color: colors.textSecondary }}>{t('common.minutes.noActionItems')}</Text>
      ) : (
        minutes.actionItems.map((item) => (
          <Text key={item.id} style={[styles.bullet, { color: colors.text }]}>
            • {item.description}
            {item.owner ? ` — ${t('common.minutes.owner')}: ${item.owner}` : ''}
            {item.dueDate ? ` — ${t('common.minutes.due')}: ${item.dueDate}` : ''}
          </Text>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: {
    paddingHorizontal: space.lg,
    paddingVertical: space.xl,
    gap: space.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
  },
  notice: {
    fontSize: fontSize.base,
    textAlign: 'center',
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  cardTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.md,
  },
  rowLabel: { fontSize: fontSize.sm },
  rowValue: { fontSize: fontSize.sm, flexShrink: 1, textAlign: 'right' },
  accent: {
    borderRadius: radius.sm,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  accentText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  outline: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    alignItems: 'center',
  },
  outlineText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  disabled: { opacity: 0.5 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sections: { gap: space.xs },
  sectionHeading: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    marginTop: space.sm,
  },
  bullet: { fontSize: fontSize.sm },
});
