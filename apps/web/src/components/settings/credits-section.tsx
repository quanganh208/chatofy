'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Badge, Button, Skeleton } from '@chatofy/ui/react';
import { getBillingPortal } from '@/clients/api-client';
import { CreditBuyActions, type SepayCheckout } from './credit-buy-actions';
import { CreditUsageList } from './credit-usage-list';
import { SepayQrPanel } from './sepay-qr-panel';
import { BalanceSummary } from './credit-balance-summary';
import { notify } from '@/lib/notify';
import { SettingsSection, SettingsSectionRow } from './settings-section';
import { ORDER_POLL_MS, useCreditBalance, useCreditUsage } from '@/hooks/use-credits';
import { useLocale, useTranslate } from '@/i18n/provider';
import { formatDay } from '@/lib/credit-format';
import { stripPolarSessionToken } from '@/lib/strip-polar-session-token';

/**
 * Settings › Billing: what is left, which plan, how to buy more, and what it went on —
 * three hairline groups, in the order a reader asks those questions.
 *
 * **No cards.** A balance and a list are readouts, not an object worked on as a unit,
 * so they are rows in a hairline group. The QR panel opens as a row of the buy group
 * for the same reason.
 *
 * **One accent at rest.** The first buy option is the tab's one filled control
 * (`credit-buy-actions.tsx` says why); manage, show-more and the QR panel's controls
 * are outline or ghost.
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

  const qrPanel = qr ? (
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
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title={t('common.billing.title')}>
        {balance === null ? (
          state === 'failed' ? (
            <p className="text-muted-foreground text-hint py-3.5">
              {t('common.billing.loadFailed')}
            </p>
          ) : (
            <div className="py-4">
              <Skeleton className="h-16 w-full" />
            </div>
          )
        ) : (
          <>
            <BalanceSummary balance={balance} />
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
            {/* A re-read failed after one succeeded: the figures above are the last
                ones known, and this says so. */}
            {state === 'failed' ? (
              <p className="text-muted-foreground text-hint py-3.5">
                {t('common.billing.loadFailed')}
              </p>
            ) : null}
          </>
        )}
      </SettingsSection>

      {balance ? <CreditBuyActions balance={balance} onSepayOrder={setQr} after={qrPanel} /> : null}

      <SettingsSection title={t('common.billing.usageTitle')}>
        <CreditUsageList usage={usage} />
      </SettingsSection>
    </div>
  );
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
