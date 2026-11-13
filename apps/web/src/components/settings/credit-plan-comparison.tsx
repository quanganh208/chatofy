'use client';

import { useId } from 'react';
import type { CreditBalance, PaymentRail, Plan } from '@chatofy/types';
import type { MessageKey } from '@chatofy/i18n';
import { Button, Skeleton } from '@chatofy/ui/react';
import { useLocale, useTranslate } from '@/i18n/provider';
import { formatDay } from '@/lib/credit-format';
import { formatUsd, formatVnd } from '@/lib/pricing-content';
import { PlanColumn } from './credit-plan-column';
import { CreditBillingGroup } from './credit-billing-group';
import { canBuyOn, checkoutKey, type UseCreditCheckout } from './use-credit-checkout';

/** One way to upgrade: the Pro plan sold on a rail, and what its button says. */
interface UpgradeOption {
  plan: Plan;
  rail: PaymentRail;
  label: MessageKey;
}

/**
 * The "Plan" group of Settings › Billing: Free beside Pro, so a reader sees what they
 * have against what they could have, at the numbers `/billing/plans` answers.
 *
 * **The current plan is marked, not filled.** Its column gets a stronger hairline and a
 * "Your plan" check; a filled ground would read as a control, and the tab's one accent
 * belongs to Upgrade.
 *
 * **Upgrade is offered to Free only**, once per rail Pro is sold on here: by card (the
 * Polar subscription) and by VietQR (the SePay pass). With checkout open, the first of
 * them — card when card is available — is the tab's one filled control; closed, both
 * are outline and disabled, and described by the tab's closed line (`closedId`). A Pro
 * account sees where Pro came from, when it renews or ends, and — for a card
 * subscription — Manage subscription, or for a VietQR pass an outline Renew by
 * VietQR (the pass does not renew itself).
 *
 * Two columns from `sm`, stacked on a phone, straight on the pane ground under the
 * heading. Each is a hairline region, not a card: neither has a shadow.
 */
export function CreditPlanComparison({
  balance,
  plans,
  checkout,
  closed,
  closedId,
  onManage,
  footer,
}: {
  balance: CreditBalance;
  /** `null` while loading; empty when the read failed. */
  plans: Plan[] | null;
  checkout: UseCreditCheckout;
  /** Buying is shut for this account: every Upgrade is outline and disabled. */
  closed: boolean;
  /** The id of the line saying why, for `aria-describedby`. */
  closedId: string;
  onManage: () => void;
  /** Under the columns: the checkout notice and an open QR panel. */
  footer?: React.ReactNode;
}) {
  const t = useTranslate();
  const locale = useLocale();
  const baseId = useId();

  if (plans === null) {
    return (
      <CreditBillingGroup title={t('web.billing.planTitle')}>
        <Skeleton className="h-48 w-full" />
      </CreditBillingGroup>
    );
  }

  const free = plans.find((plan) => plan.kind === 'free');
  const card = plans.find((plan) => plan.kind === 'subscription');
  const pass = plans.find((plan) => plan.kind === 'pass');
  const proCredits = (card ?? pass)?.credits;
  const isPro = balance.plan === 'pro';

  const upgrades: UpgradeOption[] = [];
  const cardBuyable = card !== undefined && canBuyOn(card, 'polar', balance);
  const passBuyable = pass !== undefined && canBuyOn(pass, 'sepay', balance);
  if (!isPro && cardBuyable) {
    upgrades.push({ plan: card, rail: 'polar', label: 'web.billing.upgradeCard' });
  }
  // A Free account upgrades by VietQR; a VietQR pass is renewed the same way — the
  // API keeps whichever end date is later, so renewing early loses nothing. A card
  // subscription renews itself and gets Manage instead.
  if (passBuyable && (!isPro || balance.proSource === 'sepay')) {
    upgrades.push({
      plan: pass,
      rail: 'sepay',
      label: isPro ? 'web.billing.renewQr' : 'web.billing.upgradeQr',
    });
  }

  // Plan facts, as on `/pricing`: listed whether or not a rail is up right now.
  const proPrices: string[] = [];
  if (card?.priceUsdCents != null) {
    proPrices.push(t('web.billing.priceCard', { price: formatUsd(card.priceUsdCents, locale) }));
  }
  if (pass?.priceVnd != null) {
    proPrices.push(t('web.billing.pricePass', { price: formatVnd(pass.priceVnd, locale) }));
  }
  const topups = t('web.billing.featureTopups');
  const freeFeatures = [
    ...(free
      ? [t('web.billing.featureCreditsMonthly', { credits: count(locale, free.credits) })]
      : []),
    t('web.billing.featureNoCarryOver'),
    topups,
  ];
  const proFeatures = [
    ...(proCredits === undefined
      ? []
      : [t('web.billing.featureCreditsCycle', { credits: count(locale, proCredits) })]),
    t('web.billing.featureCycleReset'),
    t('web.billing.featurePayOptions'),
    topups,
  ];

  return (
    <CreditBillingGroup title={t('web.billing.planTitle')}>
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2" data-credit-plans>
        <PlanColumn
          id="free"
          name={t('common.billing.planFree')}
          current={!isPro}
          prices={
            // Only when the API listed the Free plan; with no plans there is no price.
            // In the reader's own currency: dollars beside the card price, đồng in Vietnamese.
            free
              ? [
                  t('web.billing.freePrice', {
                    price: locale === 'vi' ? formatVnd(0, locale) : formatUsd(0, locale),
                  }),
                ]
              : []
          }
          features={freeFeatures}
        />
        <PlanColumn
          id="pro"
          name={t('common.billing.planPro')}
          current={isPro}
          prices={proPrices}
          features={proFeatures}
          status={isPro ? proStatus(t, locale, balance) : undefined}
        >
          {balance.proSource === 'polar' ? (
            <Button variant="outline" size="sm" onClick={onManage}>
              {t('web.account.manageSubscription')}
            </Button>
          ) : null}
          {upgrades.map((option, index) => {
            const key = checkoutKey({ planCode: option.plan.code, rail: option.rail });
            const buttonId = `${baseId}-${key}`;
            const offerId = `${buttonId}-offer`;
            return (
              <span key={key} className="contents">
                {/* What the button buys, said in full: the visible words are short
                    because the column above already shows the price. */}
                <span id={offerId} className="sr-only">
                  {offerLabel(t, locale, option)}
                </span>
                <Button
                  id={buttonId}
                  data-plan-checkout={option.rail}
                  // Upgrade is what a Free account came for; Renew is housekeeping.
                  variant={index === 0 && !closed && !isPro ? 'default' : 'outline'}
                  size="sm"
                  disabled={closed || checkout.pending !== null}
                  aria-labelledby={`${buttonId} ${offerId}`}
                  aria-describedby={closed ? closedId : undefined}
                  onClick={() =>
                    void checkout.start({ planCode: option.plan.code, rail: option.rail })
                  }
                >
                  {checkout.pending === key ? t('web.account.checkoutOpening') : t(option.label)}
                </Button>
              </span>
            );
          })}
        </PlanColumn>
      </div>
      {plans.length === 0 ? (
        <p className="text-muted-foreground text-hint px-1">{t('web.pricing.pricesUnavailable')}</p>
      ) : null}
      {footer}
    </CreditBillingGroup>
  );
}

/** Where Pro came from and when it renews or ends. */
function proStatus(
  t: ReturnType<typeof useTranslate>,
  locale: ReturnType<typeof useLocale>,
  balance: CreditBalance,
): string | undefined {
  const date = balance.planResetsAt ? formatDay(locale, balance.planResetsAt) : null;
  if (balance.proSource === 'polar') {
    return date ? t('web.billing.proRenewsOn', { date }) : t('common.billing.proSourcePolar');
  }
  if (balance.proSource === 'sepay' && date) return t('common.billing.proSourceSepay', { date });
  return undefined;
}

/** "Pro by card — $9.99 a month": the accessible tail of an Upgrade button. */
function offerLabel(
  t: ReturnType<typeof useTranslate>,
  locale: ReturnType<typeof useLocale>,
  option: UpgradeOption,
): string {
  return option.rail === 'polar'
    ? t('web.account.buyProCard', { price: formatUsd(option.plan.priceUsdCents ?? 0, locale) })
    : t('web.account.buyProPass', { price: formatVnd(option.plan.priceVnd ?? 0, locale) });
}

function count(locale: string, credits: number): string {
  return new Intl.NumberFormat(locale).format(credits);
}
