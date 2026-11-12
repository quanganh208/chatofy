'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { dawn } from '@chatofy/ui';
import { Badge, Button, Skeleton } from '@chatofy/ui/react';
import { AnimatedNumber } from '@/components/motion/animated-number';
import { getBillingPortal } from '@/clients/api-client';
import { CreditBuyActions, type SepayCheckout } from './credit-buy-actions';
import { CreditUsageList } from './credit-usage-list';
import { SepayQrPanel } from './sepay-qr-panel';
import { notify } from '@/lib/notify';
import { SettingsSection, SettingsSectionRow } from './settings-section';
import { ORDER_POLL_MS, useCreditBalance, useCreditUsage } from '@/hooks/use-credits';
import { useLocale, useTranslate } from '@/i18n/provider';
import { formatCredits, formatDay } from '@/lib/credit-format';
import { stripPolarSessionToken } from '@/lib/strip-polar-session-token';

/**
 * Settings › Billing: what is left, which plan, what it went on, and how to buy more.
 *
 * **On the page ground.** A balance and a list are readouts, not an object worked on
 * as a unit, so they are rows under a heading. The QR panel opens inline with a
 * hairline for the same reason.
 *
 * **No accent.** Buy, manage and show-more are outline or ghost, so this page stays
 * at zero filled controls in every state.
 *
 * **Outcomes are toasts.** A checkout or portal that would not open says so with
 * Retry; coming back from Polar (`?checkout=done`, which `/account?checkout=done`
 * is redirected to as well) says the payment finished and reads the balance again
 * after a moment, because the redirect and the webhook that grants the credits race.
 */
export function CreditsSection() {
  const t = useTranslate();
  const locale = useLocale();
  const credits = useCreditBalance();
  // After the balance answered either way; see `useCreditUsage`.
  const usage = useCreditUsage(credits.state !== 'loading');
  const [qr, setQr] = useState<SepayCheckout | null>(null);
  // Back from Polar's hosted checkout (its success URL). Read from the address
  // rather than copied into state; the query stays, so a reload says it again
  // and reads the balance again, both of which are still true.
  const returned = useSearchParams()?.get('checkout') === 'done';
  const { refresh: refreshBalance } = credits;
  const { refetch: refetchUsage } = usage;

  // Polar adds its customer session token to the success URL; nothing here
  // reads it, so it is taken out of the address bar and history at once.
  useEffect(() => {
    stripPolarSessionToken(window.location, window.history);
  }, []);

  useEffect(() => {
    if (!returned) return;
    // Same id on every render, so a re-render or a reload replaces it rather than
    // stacking a second one.
    notify.success(t('web.account.checkoutReturned'), { id: 'checkout-returned' });
    const timer = setTimeout(() => {
      void refreshBalance();
      void refetchUsage();
    }, ORDER_POLL_MS);
    return () => clearTimeout(timer);
  }, [returned, refreshBalance, refetchUsage, t]);

  const openPortal = async () => {
    notify.dismiss('billing-portal');
    try {
      const { url } = await getBillingPortal();
      window.location.assign(url);
    } catch {
      notify.error(t('web.account.checkoutFailed'), {
        id: 'billing-portal',
        retry: () => void openPortal(),
      });
    }
  };

  const { balance, state } = credits;

  return (
    <div className="flex flex-col gap-8">
      <SettingsSection title={t('common.billing.title')}>
        {balance === null ? (
          state === 'failed' ? (
            <p className="text-muted-foreground text-hint py-3.5">
              {t('common.billing.loadFailed')}
            </p>
          ) : (
            <Skeleton className="my-3.5 h-10 w-full" />
          )
        ) : (
          <>
            <div className="border-border flex flex-col gap-3 border-b py-4">
              <span className="text-muted-foreground text-label font-semibold tracking-wide uppercase">
                {t('common.billing.totalCredits')}
              </span>
              <AnimatedNumber
                data-credit-total
                value={balance.totalCredits}
                format={(n) => formatCredits(t, locale, n)}
                className="text-title font-display leading-none font-light tabular-nums"
              />
              {/* The split at a glance: this period's plan credits in the dawn gradient,
                  top-ups in the muted tone. Decorative: the two rows below say the same in
                  words, so a screen reader hears them once. */}
              <div aria-hidden className="bg-muted flex h-1.5 w-full overflow-hidden rounded-full">
                <span
                  className="duration-slow ease-standard h-full transition-[width] motion-reduce:transition-none"
                  style={{
                    width: `${share(balance.planCredits, balance.totalCredits)}%`,
                    backgroundImage: `linear-gradient(90deg, ${dawn.peach}, ${dawn.lavender}, ${dawn.mint})`,
                  }}
                />
                <span
                  className="bg-muted-foreground/60 duration-slow ease-standard h-full transition-[width] motion-reduce:transition-none"
                  style={{ width: `${share(balance.topupCredits, balance.totalCredits)}%` }}
                />
              </div>
            </div>
            <SettingsSectionRow
              label={t('common.billing.planCredits')}
              note={
                balance.planResetsAt
                  ? t('common.billing.planResetsOn', {
                      date: formatDay(locale, balance.planResetsAt),
                    })
                  : undefined
              }
            >
              <span className="text-body tabular-nums">
                {formatCredits(t, locale, balance.planCredits)}
              </span>
            </SettingsSectionRow>
            <SettingsSectionRow
              label={t('common.billing.topupCredits')}
              note={t('common.billing.topupNeverExpire')}
            >
              <span className="text-body tabular-nums">
                {formatCredits(t, locale, balance.topupCredits)}
              </span>
            </SettingsSectionRow>
            <SettingsSectionRow
              label={t('common.billing.currentPlan')}
              note={proSourceNote(t, locale, balance.proSource, balance.planResetsAt)}
            >
              <Badge variant="outline">
                {balance.plan === 'pro'
                  ? t('common.billing.planPro')
                  : t('common.billing.planFree')}
              </Badge>
              {balance.proSource === 'polar' ? (
                <Button variant="outline" size="sm" onClick={() => void openPortal()}>
                  {t('web.account.manageSubscription')}
                </Button>
              ) : null}
            </SettingsSectionRow>
            <CreditBuyActions balance={balance} onSepayOrder={setQr} />
            {qr ? (
              <SepayQrPanel
                key={qr.orderId}
                order={qr}
                onPaid={() => {
                  notify.success(t('web.account.qrPaid'), { id: 'sepay-paid' });
                  void refreshBalance();
                  void refetchUsage();
                }}
                onClose={() => setQr(null)}
              />
            ) : null}
            {state === 'failed' ? (
              <p className="text-muted-foreground text-hint pt-2">
                {t('common.billing.loadFailed')}
              </p>
            ) : null}
          </>
        )}
      </SettingsSection>

      <SettingsSection title={t('common.billing.usageTitle')}>
        <CreditUsageList usage={usage} />
      </SettingsSection>
    </div>
  );
}

/** `part` as a percentage of `whole`, 0 when there is nothing to divide. */
function share(part: number, whole: number): number {
  return whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0;
}

/** Where Pro came from, under the plan badge; nothing on Free. */
function proSourceNote(
  t: ReturnType<typeof useTranslate>,
  locale: ReturnType<typeof useLocale>,
  source: 'polar' | 'sepay' | null,
  endsAt: string | null,
): string | undefined {
  if (source === 'polar') return t('common.billing.proSourcePolar');
  if (source === 'sepay' && endsAt) {
    return t('common.billing.proSourceSepay', { date: formatDay(locale, endsAt) });
  }
  return undefined;
}
