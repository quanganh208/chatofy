'use client';

import { useEffect, useId, useState } from 'react';
import { ApiClientError } from '@chatofy/api-client';
import type { CheckoutResponse, CreditBalance, PaymentRail, Plan } from '@chatofy/types';
import { Button } from '@chatofy/ui/react';
import { createCheckout, listPlans } from '@/clients/api-client';
import { useLocale, useTranslate } from '@/i18n/provider';
import { formatCredits } from '@/lib/credit-format';
import { notify } from '@/lib/notify';
import { formatUsd, formatVnd } from '@/lib/pricing-content';
import { SettingsSection } from './settings-section';

/** A VietQR order the section shows in its inline panel. */
export type SepayCheckout = Extract<CheckoutResponse, { rail: 'sepay' }>;

/** The test-mode line for each rail, in button order. */
const SANDBOX_HINT_RAILS = ['polar', 'sepay'] as const satisfies readonly PaymentRail[];
const SANDBOX_HINT = {
  polar: 'web.account.railSandboxCard',
  sepay: 'web.account.railSandboxQr',
} as const satisfies Record<PaymentRail, string>;

/** One buy button: which plan, on which rail, and what it says. */
interface BuyOption {
  key: string;
  planCode: string;
  rail: PaymentRail;
  label: string;
}

/**
 * The "Buy credits" group: one row per plan per rail the API sells, the offer on the
 * left and its Buy button on the right.
 *
 * **One accent when buying is open.** The first row's Buy is filled — the options are
 * sorted Pro first, so it is the offer a Free account most likely came here for — and
 * every other is outline. For a closed account every Buy is outline: a filled button
 * reads as available, and disabled it would promise what the account cannot do.
 *
 * **A checkout that would not open is a toast with Retry**; the one refusal that
 * needs explaining where it happened — checkout is not open to this account — stays
 * inline under the buttons.
 *
 * **Eligibility is the API's answer.** `checkoutAllowed` false disables every
 * button and points each at the same explanation with `aria-describedby`, so a
 * screen reader hears why the control is dead, not just that it is. The
 * checkout route refuses again whatever this page shows.
 *
 * **A rail reported `unavailable` is left out entirely** rather than shown
 * disabled: its secrets are missing on this deployment and no account could
 * use it, so a dead button would only advertise a fault.
 */
export function CreditBuyActions({
  balance,
  onSepayOrder,
  after,
}: {
  balance: CreditBalance;
  /** A VietQR order was created; the section opens the QR panel for it. */
  onSepayOrder: (order: SepayCheckout) => void;
  /** A last row of the group: the open QR panel, so paying stays beside buying. */
  after?: React.ReactNode;
}) {
  const t = useTranslate();
  const locale = useLocale();
  const baseId = useId();
  const closedId = `${baseId}-closed`;
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  // Only the refusal that needs explaining in place; any other failure is a toast.
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listPlans()
      .then((answer) => {
        if (!cancelled) setPlans(answer.plans);
      })
      // No plans means no buttons: the balance above is still the page's answer.
      .catch(() => {
        if (!cancelled) setPlans([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const options = buyOptions(plans ?? [], balance, (plan, rail) => {
    if (plan.kind === 'subscription') {
      return t('web.account.buyProCard', {
        price: formatUsd(plan.priceUsdCents ?? 0, locale),
      });
    }
    if (plan.kind === 'pass') {
      return t('web.account.buyProPass', { price: formatVnd(plan.priceVnd ?? 0, locale) });
    }
    const credits = formatCredits(t, locale, plan.credits);
    return rail === 'polar'
      ? t('web.account.buyTopupCard', {
          credits,
          price: formatUsd(plan.priceUsdCents ?? 0, locale),
        })
      : t('web.account.buyTopupQr', { credits, price: formatVnd(plan.priceVnd ?? 0, locale) });
  });
  if (options.length === 0) return null;

  // Named per rail: one rail can be live while the other is a sandbox, and a
  // single "test mode" line would then sit under buttons that charge real money.
  const sandboxRails = SANDBOX_HINT_RAILS.filter(
    (rail) => balance.rails[rail] === 'sandbox' && options.some((option) => option.rail === rail),
  );
  const closed = !balance.checkoutAllowed;

  const buy = async (option: BuyOption) => {
    setPending(option.key);
    setRefused(false);
    notify.dismiss('checkout');
    try {
      const answer = await createCheckout({ planCode: option.planCode, rail: option.rail });
      if (answer.rail === 'polar') {
        // Left in `pending` on purpose: the page is navigating away.
        window.location.assign(answer.url);
        return;
      }
      onSepayOrder(answer);
    } catch (err) {
      if (err instanceof ApiClientError && err.error.code === 'CHECKOUT_NOT_OPEN') {
        setRefused(true);
      } else {
        notify.error(t('web.account.checkoutFailed'), {
          id: 'checkout',
          retry: () => void buy(option),
        });
      }
    }
    setPending(null);
  };

  const showClosed = closed || refused;
  // Test mode is said only where buying is possible at all.
  const shownSandboxRails = closed ? [] : sandboxRails;

  return (
    <div data-credit-buy-actions>
      <SettingsSection title={t('web.account.buyTitle')}>
        {/* First, so the reason is read before the row of dead buttons it explains. */}
        {showClosed ? (
          <p id={closedId} className="text-muted-foreground text-hint max-w-prose py-3">
            {t('common.billing.checkoutClosed')}
          </p>
        ) : null}
        {options.map((option, index) => {
          const labelId = `${baseId}-${option.key}`;
          const buttonId = `${labelId}-buy`;
          return (
            <div
              key={option.key}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 py-2.5"
            >
              <span id={labelId} className="text-body">
                {option.label}
              </span>
              {/* Named "Buy <option>" by its own word plus the row's label, so the
                  visible word is the start of what a screen reader says. */}
              <Button
                id={buttonId}
                variant={index === 0 && !closed ? 'default' : 'outline'}
                size="sm"
                disabled={closed || pending !== null}
                aria-labelledby={`${buttonId} ${labelId}`}
                aria-describedby={closed ? closedId : undefined}
                onClick={() => void buy(option)}
              >
                {pending === option.key ? t('web.account.checkoutOpening') : t('web.account.buy')}
              </Button>
            </div>
          );
        })}
        {shownSandboxRails.length > 0 ? (
          <div className="flex flex-col gap-1 py-3">
            {shownSandboxRails.map((rail) => (
              <p key={rail} className="text-muted-foreground text-hint" data-rail-sandbox={rail}>
                {t(SANDBOX_HINT[rail])}
              </p>
            ))}
          </div>
        ) : null}
        {after}
      </SettingsSection>
    </div>
  );
}

/**
 * Every (plan, rail) pair to offer, in a stable order: Pro first, then top-ups
 * by size. A rail is offered only when the plan is sold on it, it has a price
 * there, and this deployment does not report it unavailable.
 */
function buyOptions(
  plans: Plan[],
  balance: CreditBalance,
  label: (plan: Plan, rail: PaymentRail) => string,
): BuyOption[] {
  const order = { subscription: 0, pass: 1, topup: 2, free: 3 } as const;
  const sorted = [...plans]
    .filter((plan) => plan.kind !== 'free')
    .sort((a, b) => order[a.kind] - order[b.kind] || a.credits - b.credits);
  const options: BuyOption[] = [];
  for (const plan of sorted) {
    for (const rail of plan.rails) {
      if (balance.rails[rail] === 'unavailable') continue;
      const price = rail === 'polar' ? plan.priceUsdCents : plan.priceVnd;
      if (price === null) continue;
      options.push({
        key: `${plan.code}:${rail}`,
        planCode: plan.code,
        rail,
        label: label(plan, rail),
      });
    }
  }
  return options;
}
