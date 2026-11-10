'use client';

import { useEffect, useId, useState } from 'react';
import { ApiClientError } from '@chatofy/api-client';
import type { CheckoutResponse, CreditBalance, PaymentRail, Plan } from '@chatofy/types';
import { Button } from '@chatofy/ui/react';
import { createCheckout, listPlans } from '@/clients/api-client';
import { useLocale, useTranslate } from '@/i18n/provider';
import { formatCredits } from '@/lib/credit-format';
import { formatUsd, formatVnd } from '@/lib/pricing-content';

/** A VietQR order the section shows in its inline panel. */
export type SepayCheckout = Extract<CheckoutResponse, { rail: 'sepay' }>;

/** One buy button: which plan, on which rail, and what it says. */
interface BuyOption {
  key: string;
  planCode: string;
  rail: PaymentRail;
  label: string;
}

/**
 * The buy buttons for every plan the API sells, one per plan per rail.
 *
 * **All outline.** `/account` spends no accent: buying is an ordinary action on
 * a settings screen, and the password form's submit already owns the one filled
 * control when it is open. The accent spec holds every `/account` state at 0.
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
}: {
  balance: CreditBalance;
  /** A VietQR order was created; the section opens the QR panel for it. */
  onSepayOrder: (order: SepayCheckout) => void;
}) {
  const t = useTranslate();
  const locale = useLocale();
  const closedId = useId();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<'closed' | 'failed' | null>(null);

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

  const sandbox = options.some((option) => balance.rails[option.rail] === 'sandbox');
  const closed = !balance.checkoutAllowed;

  const buy = async (option: BuyOption) => {
    setPending(option.key);
    setFailure(null);
    try {
      const answer = await createCheckout({ planCode: option.planCode, rail: option.rail });
      if (answer.rail === 'polar') {
        // Left in `pending` on purpose: the page is navigating away.
        window.location.assign(answer.url);
        return;
      }
      onSepayOrder(answer);
    } catch (err) {
      setFailure(
        err instanceof ApiClientError && err.error.code === 'CHECKOUT_NOT_OPEN'
          ? 'closed'
          : 'failed',
      );
    }
    setPending(null);
  };

  return (
    <div className="flex flex-col gap-2.5 py-3.5" data-credit-buy-actions>
      <span className="text-body font-medium">{t('web.account.buyTitle')}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option.key}
            variant="outline"
            size="sm"
            disabled={closed || pending !== null}
            aria-describedby={closed ? closedId : undefined}
            onClick={() => void buy(option)}
          >
            {pending === option.key ? t('web.account.checkoutOpening') : option.label}
          </Button>
        ))}
      </div>
      {closed || failure === 'closed' ? (
        <p id={closedId} className="text-muted-foreground text-hint max-w-prose">
          {t('common.billing.checkoutClosed')}
        </p>
      ) : null}
      {failure === 'failed' ? (
        <p role="alert" className="text-destructive text-hint">
          {t('web.account.checkoutFailed')}
        </p>
      ) : null}
      {sandbox && !closed ? (
        <p className="text-muted-foreground text-hint">{t('web.account.railSandbox')}</p>
      ) : null}
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
