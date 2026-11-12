/**
 * The "Credits & plan" block of settings: what is left and where it comes from,
 * the plan, and the newest usage rows. Text on the ground, no card and no
 * accent — the screen's one accent stays the native switch. Buying is never done
 * here: an account let in to checkout gets an outline link to the web's Settings ›
 * Billing page, everyone else the sentence saying why buying is closed.
 */

import { useCallback } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { createTranslator, en, type MessageKey } from '@chatofy/i18n';
import type { CreditBalance, CreditUsageKind } from '@chatofy/types';
import { space, fontSize, fontWeight } from '@chatofy/ui';
import { getCreditBalance, listCreditUsage } from '@/clients/api-client';
import { WEB_BASE_URL } from '@/config/web-base-url';
import { useTheme } from '@/providers/theme-provider';
import { GhostButton } from '@/ui/components/ghost-button';
import { InlineNotice } from '@/ui/components/inline-notice';
import { ListRow } from '@/ui/components/list-row';
import { creditAmountMessage, creditDate, creditSign } from './credit-amount';
import { buyActionFor, useCreditBalance, type CreditFetchers } from './use-credit-balance';

// English, like the rest of settings.
const t = createTranslator(en);

const FETCHERS: CreditFetchers = { balance: getCreditBalance, usage: listCreditUsage };

const USAGE_KIND_KEY: Record<CreditUsageKind, MessageKey> = {
  translate: 'common.billing.usageKind.translate',
  minutes: 'common.billing.usageKind.minutes',
  grant: 'common.billing.usageKind.grant',
  refund: 'common.billing.usageKind.refund',
  expire: 'common.billing.usageKind.expire',
  void: 'common.billing.usageKind.void',
};

function credits(amount: number): string {
  const message = creditAmountMessage(amount);
  return t(message.key, message.vars);
}

function openBillingOnWeb(): void {
  Linking.openURL(`${WEB_BASE_URL}/settings/billing`).catch((err: unknown) =>
    console.warn('[settings] could not open the web billing page', err),
  );
}

export function CreditsSummary({ signedIn }: { signedIn: boolean }) {
  const { colors } = useTheme();
  const state = useCreditBalance(FETCHERS, signedIn);
  const { refetch } = state;

  // Settings stays mounted behind its tab, so a conversation spent elsewhere
  // would leave a stale balance here; coming back into view reads both again.
  useFocusEffect(useCallback(() => refetch(), [refetch]));

  if (!signedIn) return null;

  return (
    <View style={styles.block}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
        {t('common.billing.title')}
      </Text>

      {state.balanceFailed ? (
        <InlineNotice tone="error" message={t('common.billing.loadFailed')} />
      ) : state.balance ? (
        <BalanceLines balance={state.balance} />
      ) : null}

      <Text accessibilityRole="header" style={[styles.subheading, { color: colors.text }]}>
        {t('common.billing.usageTitle')}
      </Text>
      {state.usageFailed ? (
        <InlineNotice tone="error" message={t('common.billing.usageLoadFailed')} />
      ) : !state.usageLoading && state.usage.length === 0 ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          {t('common.billing.usageEmpty')}
        </Text>
      ) : (
        state.usage.map((entry) => (
          <ListRow
            key={entry.id}
            title={t(USAGE_KIND_KEY[entry.kind])}
            subtitle={
              entry.label ? `${entry.label} · ${creditDate(entry.at)}` : creditDate(entry.at)
            }
            trailing={`${creditSign(entry.credits)}${credits(entry.credits)}`}
          />
        ))
      )}
    </View>
  );
}

function BalanceLines({ balance }: { balance: CreditBalance }) {
  const { colors } = useTheme();
  const planName = t(balance.plan === 'pro' ? 'common.billing.planPro' : 'common.billing.planFree');
  const proSource =
    balance.proSource === 'polar'
      ? t('common.billing.proSourcePolar')
      : balance.proSource === 'sepay' && balance.planResetsAt
        ? t('common.billing.proSourceSepay', { date: creditDate(balance.planResetsAt) })
        : null;

  return (
    <>
      <Line label={t('common.billing.totalCredits')} value={credits(balance.totalCredits)} strong />
      <Line
        label={t('common.billing.planCredits')}
        value={credits(balance.planCredits)}
        detail={
          balance.planResetsAt
            ? t('common.billing.planResetsOn', { date: creditDate(balance.planResetsAt) })
            : undefined
        }
      />
      <Line
        label={t('common.billing.topupCredits')}
        value={credits(balance.topupCredits)}
        detail={t('common.billing.topupNeverExpire')}
      />
      <Line
        label={t('common.billing.currentPlan')}
        value={planName}
        detail={proSource ?? undefined}
      />

      {buyActionFor(balance) === 'buy-on-web' ? (
        <GhostButton
          variant="outline"
          label={t('mobile.settings.buyOnWeb')}
          onPress={openBillingOnWeb}
        />
      ) : (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          {t('common.billing.checkoutClosed')}
        </Text>
      )}
    </>
  );
}

function Line({
  label,
  value,
  detail,
  strong = false,
}: {
  label: string;
  value: string;
  detail?: string;
  strong?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View>
      <View style={styles.row}>
        <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
        <Text
          style={[
            styles.value,
            { color: colors.text, fontWeight: strong ? fontWeight.semibold : fontWeight.regular },
          ]}
        >
          {value}
        </Text>
      </View>
      {detail ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { alignSelf: 'stretch', gap: space.sm, marginTop: space.lg },
  heading: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  subheading: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, marginTop: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
  },
  label: { flex: 1, fontSize: fontSize.base },
  value: { fontSize: fontSize.base },
  hint: { fontSize: fontSize.sm },
});
