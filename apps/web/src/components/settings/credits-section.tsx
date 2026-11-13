'use client';

import { useEffect, useId, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Skeleton } from '@chatofy/ui/react';
import { getBillingPortal } from '@/clients/api-client';
import { CheckoutNotice } from './credit-checkout-notice';
import { CreditPlanComparison } from './credit-plan-comparison';
import { CreditTopupPacks } from './credit-topup-packs';
import { CreditUsageList } from './credit-usage-list';
import { SepayQrPanel } from './sepay-qr-panel';
import { BalanceSummary } from './credit-balance-summary';
import { notify } from '@/lib/notify';
import { SettingsSection } from './settings-section';
import { ORDER_POLL_MS, useCreditBalance, useCreditUsage } from '@/hooks/use-credits';
import { useTranslate } from '@/i18n/provider';
import { stripPolarSessionToken } from '@/lib/strip-polar-session-token';
import {
  useBillingPlans,
  useCreditCheckout,
  type CheckoutTarget,
  type SepayCheckout,
} from './use-credit-checkout';

/** An open VietQR order, and whether it came from Upgrade or from a top-up tile. */
interface OpenQr {
  order: SepayCheckout;
  from: 'plan' | 'topup';
}

/**
 * Settings › Billing: what is left, which plan against the other, how to buy more,
 * and what it went on — four hairline groups, in the order a reader asks.
 *
 * **No cards.** The balance and the usage list are readouts; the plan columns and the
 * top-up tiles are hairline regions inside their group's box with no shadow. The QR
 * panel opens as a row of the group whose button made the order.
 *
 * **At most one accent.** A Free account with checkout open fills Upgrade (card
 * first); a Pro account fills nothing, and neither does a closed checkout — every
 * Upgrade and Buy is outline and disabled, described by one muted line that ends the
 * Plan group. Manage, show-more and the QR panel's controls are outline or ghost.
 *
 * **Outcomes are toasts.** A checkout or portal that would not open says so with
 * Retry; coming back from Polar (`?checkout=done`, which `/account?checkout=done`
 * is redirected to as well) says the payment finished and reads the balance again
 * after a moment, because the redirect and the webhook that grants the credits race.
 */
export function CreditsSection() {
  const t = useTranslate();
  const credits = useCreditBalance();
  // After the balance answered either way; see `useCreditUsage`.
  const usage = useCreditUsage(credits.state !== 'loading');
  const [qr, setQr] = useState<OpenQr | null>(null);
  const closedId = `${useId()}-closed`;
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

  const plans = useBillingPlans();
  // The panel opens in the group whose button made the order.
  const checkout = useCreditCheckout((order: SepayCheckout, target: CheckoutTarget) => {
    const kind = plans?.find((plan) => plan.code === target.planCode)?.kind;
    setQr({ order, from: kind === 'topup' ? 'topup' : 'plan' });
  });

  const { balance, state } = credits;
  const closed = balance ? !balance.checkoutAllowed : true;

  const qrPanel = qr ? (
    <SepayQrPanel
      key={qr.order.orderId}
      order={qr.order}
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

      {balance ? (
        <CreditPlanComparison
          balance={balance}
          plans={plans}
          checkout={checkout}
          closed={closed}
          closedId={closedId}
          onManage={() => void openPortal()}
          footer={
            <>
              <CheckoutNotice balance={balance} closedId={closedId} refused={checkout.refused} />
              {qr?.from === 'plan' ? qrPanel : null}
            </>
          }
        />
      ) : null}

      {balance && plans ? (
        <CreditTopupPacks
          balance={balance}
          plans={plans}
          checkout={checkout}
          closed={closed}
          closedId={closedId}
          after={qr?.from === 'topup' ? qrPanel : null}
        />
      ) : null}

      <SettingsSection title={t('common.billing.usageTitle')}>
        <CreditUsageList usage={usage} />
      </SettingsSection>
    </div>
  );
}
