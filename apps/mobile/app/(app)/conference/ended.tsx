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
import { createTranslator, en, type MessageKey } from '@chatofy/i18n';
import {
  conferenceDurationMinutes,
  languageCodeSchema,
  type ConferenceDetailResponse,
  type ConferenceMinutes,
  type LanguageCode,
} from '@chatofy/types';
import { useTheme } from '@/providers/theme-provider';
import { useConferenceEnd } from '@/conference/use-conference-end';
import { participantNames, spokenLanguages } from '@/conference/meeting-summary';

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
    body = <Notice messageKey="mobile.conference.endedLoading" />;
  } else if (end.load === 'not-found') {
    body = <Notice messageKey="mobile.conference.endedNotFound" />;
  } else if (end.load === 'failed' || !end.conference) {
    body = <Notice messageKey="mobile.conference.endedLoadFailed" />;
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
          {t('mobile.conference.endedTitle')}
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
        {t('mobile.conference.backToLobby')}
      </Text>
    </TouchableOpacity>
  );
}

function formatDuration(conference: ConferenceDetailResponse): string {
  const total = conferenceDurationMinutes(conference);
  if (total === null) return t('mobile.conference.durationUnknown');
  if (total < 60) return t('mobile.conference.durationMinutes', { minutes: String(total) });
  return t('mobile.conference.durationHours', {
    hours: String(Math.floor(total / 60)),
    minutes: String(total % 60),
  });
}

function languageName(code: string): string {
  const parsed = languageCodeSchema.safeParse(code);
  return parsed.success ? t(`mobile.languageName.${parsed.data}`) : code;
}

function SummaryCard({ conference }: { conference: ConferenceDetailResponse }) {
  const { colors } = useTheme();
  const languages = spokenLanguages(conference).map(languageName);
  const rows: [string, string][] = [
    [t('mobile.conference.summaryDuration'), formatDuration(conference)],
    [
      t('mobile.conference.participants'),
      participantNames(conference, t('mobile.conference.guest')).join(', ') || '—',
    ],
    [
      t('mobile.conference.summaryLanguages'),
      (languages.length === 2 ? languages.join(' ↔ ') : languages.join(', ')) || '—',
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
    state = (
      <Text style={{ color: colors.textSecondary }}>
        {t('mobile.conference.minutesNothingSaid')}
      </Text>
    );
  } else if (failed) {
    state = (
      <Text style={{ color: colors.destructive }}>{t('mobile.conference.minutesFailed')}</Text>
    );
  } else if (!ready) {
    state = (
      <Text style={{ color: colors.textSecondary }}>{t('mobile.conference.minutesEmpty')}</Text>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.cardTitle, { color: colors.text }]}>
        {t('mobile.conference.minutesTitle')}
      </Text>
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
            {ready
              ? t('mobile.conference.minutesRegenerate')
              : t('mobile.conference.minutesGenerate')}
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
      {heading('mobile.conference.minutesSummary')}
      <Text style={{ color: colors.text }}>{minutes.summary}</Text>
      {minutes.keyPoints.length > 0 ? (
        <>
          {heading('mobile.conference.minutesKeyPoints')}
          {bullets(minutes.keyPoints)}
        </>
      ) : null}
      {minutes.decisions.length > 0 ? (
        <>
          {heading('mobile.conference.minutesDecisions')}
          {bullets(minutes.decisions)}
        </>
      ) : null}
      {heading('mobile.conference.minutesActionItems')}
      {minutes.actionItems.length === 0 ? (
        <Text style={{ color: colors.textSecondary }}>
          {t('mobile.conference.minutesNoActionItems')}
        </Text>
      ) : (
        minutes.actionItems.map((item) => (
          <Text key={item.id} style={[styles.bullet, { color: colors.text }]}>
            • {item.description}
            {item.owner ? ` — ${t('mobile.conference.minutesOwner')}: ${item.owner}` : ''}
            {item.dueDate ? ` — ${t('mobile.conference.minutesDue')}: ${item.dueDate}` : ''}
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
