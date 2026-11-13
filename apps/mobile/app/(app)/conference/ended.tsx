/**
 * Meeting end screen — where Leave and an owner-ended meeting land.
 *
 * Heading, the summary card (duration, participants, languages), Back to lobby,
 * then the room's minutes on the screen ground: generated on demand, one stored copy per room that any
 * participant may (re)generate. Mobile writes them in the language the caller
 * spoke in the call (`lang`), since its UI has no locale of its own yet.
 *
 * Design budget, as on web: Back to lobby is the ONE accent-filled control;
 * Generate / Regenerate is outlined. One surface: the summary card. The minutes
 * sit under a hairline with each group divided by another, as the web
 * `MinutesPanel` does, because they are read rather than acted on as a unit.
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
        <MinutesPanel
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

function MinutesPanel({
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
    <View style={[styles.panel, { borderColor: colors.border }]}>
      {/* Wraps rather than squeezes, as on web: the title stays whole and the
          button drops below it on a narrow screen. */}
      <View style={styles.panelHeader}>
        <Text style={[styles.panelTitle, { color: colors.text }]} accessibilityRole="header">
          {t('common.minutes.title')}
        </Text>
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
      {state}
      {ready && !generating ? <MinutesContent minutes={ready} /> : null}
    </View>
  );
}

function MinutesContent({ minutes }: { minutes: ConferenceMinutes }) {
  const { colors } = useTheme();
  // One group per heading, each opened by a hairline, the way the web panel's
  // `Section` divides them.
  const group = (key: MessageKey, children: React.ReactNode) => (
    <View style={[styles.group, { borderColor: colors.border }]}>
      <Text style={[styles.groupHeading, { color: colors.textSecondary }]}>{t(key)}</Text>
      {children}
    </View>
  );
  // Keyed by text plus its occurrence, so two identical bullets stay distinct.
  const bullets = (items: string[]) => {
    const seen = new Map<string, number>();
    return items.map((item) => {
      const occurrence = (seen.get(item) ?? 0) + 1;
      seen.set(item, occurrence);
      return (
        <Text key={`${occurrence}:${item}`} style={[styles.bullet, { color: colors.text }]}>
          • {item}
        </Text>
      );
    });
  };

  return (
    <View style={styles.groups}>
      {group(
        'common.minutes.summary',
        <Text style={{ color: colors.text }}>{minutes.summary}</Text>,
      )}
      {minutes.keyPoints.length > 0
        ? group('common.minutes.keyPoints', bullets(minutes.keyPoints))
        : null}
      {minutes.decisions.length > 0
        ? group('common.minutes.decisions', bullets(minutes.decisions))
        : null}
      {group(
        'common.minutes.actionItems',
        minutes.actionItems.length === 0 ? (
          <Text style={{ color: colors.textSecondary }}>{t('common.minutes.noActionItems')}</Text>
        ) : (
          minutes.actionItems.map((item) => (
            <Text key={item.id} style={[styles.bullet, { color: colors.text }]}>
              • {item.description}
              {item.owner ? ` — ${t('common.minutes.owner')}: ${item.owner}` : ''}
              {item.dueDate ? ` — ${t('common.minutes.due')}: ${item.dueDate}` : ''}
            </Text>
          ))
        ),
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
  // The minutes: on the screen ground under a hairline, no fill and no box.
  panel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.md,
    gap: space.md,
  },
  panelHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: space.sm,
    rowGap: space.md,
  },
  panelTitle: {
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
    paddingHorizontal: space.md,
    alignItems: 'center',
  },
  outlineText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  disabled: { opacity: 0.5 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  groups: { gap: space.md },
  group: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.sm,
    gap: space.xs,
  },
  groupHeading: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
  },
  bullet: { fontSize: fontSize.sm },
});
