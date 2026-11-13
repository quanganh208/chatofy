'use client';

import { useEffect, useState } from 'react';
import { ApiClientError } from '@chatofy/api-client';
import type { CheckoutResponse, CreditBalance, PaymentRail, Plan } from '@chatofy/types';
import { createCheckout, listPlans } from '@/clients/api-client';
import { useTranslate } from '@/i18n/provider';
import { notify } from '@/lib/notify';

/** A VietQR order the Billing tab shows in its inline panel. */
export type SepayCheckout = Extract<CheckoutResponse, { rail: 'sepay' }>;

/** One purchase: which plan, on which rail. */
export interface CheckoutTarget {
  planCode: string;
  rail: PaymentRail;
}

/** `${planCode}:${rail}`: names the button a checkout is opening from. */
export const checkoutKey = (target: CheckoutTarget) => `${target.planCode}:${target.rail}`;

/**
 * The plans the API sells, as Settings › Billing reads them once on open.
 *
 * `null` while loading; an empty list when the read failed, because the balance above
 * is still the tab's answer and a missing price table must not take it down.
 */
export function useBillingPlans(): Plan[] | null {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    listPlans()
      .then((answer) => {
        if (!cancelled) setPlans(answer.plans);
      })
      .catch(() => {
        if (!cancelled) setPlans([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return plans;
}

/**
 * Whether `plan` can be bought on `rail` from this deployment: the plan is sold there,
 * it has a price there, and the rail is not reported unavailable (its secrets are
 * missing, so no account could use it).
 */
export function canBuyOn(plan: Plan, rail: PaymentRail, balance: CreditBalance): boolean {
  if (!plan.rails.includes(rail) || balance.rails[rail] === 'unavailable') return false;
  return (rail === 'polar' ? plan.priceUsdCents : plan.priceVnd) !== null;
}

export interface UseCreditCheckout {
  /** The key of the checkout being opened, so only its button says so. */
  pending: string | null;
  /** The API refused with `CHECKOUT_NOT_OPEN`: the tab shows the closed line. */
  refused: boolean;
  start: (target: CheckoutTarget) => Promise<void>;
}

/**
 * Opening a checkout, shared by the plan comparison's Upgrade and the top-up tiles.
 *
 * Polar answers a hosted page and the tab navigates to it (left `pending` on purpose:
 * the page is going away). SePay answers a VietQR order, handed to `onSepayOrder` for
 * the inline panel. The one refusal that needs explaining in place — checkout is not
 * open to this account — sets `refused`; any other failure is a toast with Retry.
 */
export function useCreditCheckout(
  onSepayOrder: (order: SepayCheckout, target: CheckoutTarget) => void,
): UseCreditCheckout {
  const t = useTranslate();
  const [pending, setPending] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);

  const start = async (target: CheckoutTarget): Promise<void> => {
    setPending(checkoutKey(target));
    setRefused(false);
    notify.dismiss('checkout');
    try {
      const answer = await createCheckout(target);
      if (answer.rail === 'polar') {
        // Left `pending` on purpose: the page is navigating away.
        window.location.assign(answer.url);
        return;
      }
      onSepayOrder(answer, target);
    } catch (err) {
      if (err instanceof ApiClientError && err.error.code === 'CHECKOUT_NOT_OPEN') {
        setRefused(true);
      } else {
        notify.error(t('web.account.checkoutFailed'), {
          id: 'checkout',
          retry: () => void start(target),
        });
      }
    }
    setPending(null);
  };

  return { pending, refused, start };
}
