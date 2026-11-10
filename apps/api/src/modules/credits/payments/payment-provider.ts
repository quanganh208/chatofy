import type { CheckoutResponse, PaymentRail, RailStatus } from '@chatofy/types';
import type { PlanRow } from '../plan-catalog';

/** The buyer, as the checkout route has already verified them. */
export interface CheckoutUser {
  id: string;
  email: string;
}

/**
 * One payment rail behind `POST /billing/checkout`.
 *
 * Checkout only STARTS a purchase; nothing is granted here. Credits arrive
 * through the rail's signed webhook, which is the only proof of payment.
 */
export interface PaymentProvider {
  readonly rail: PaymentRail;
  /** `unavailable` when this deployment lacks the rail's secrets. */
  status(): RailStatus;
  /** Whether `plan` can be bought on this rail right now. */
  offers(plan: PlanRow): boolean;
  createCheckout(user: CheckoutUser, plan: PlanRow): Promise<CheckoutResponse>;
}

/**
 * The provider's own API failed or refused (network, 5xx, an unexpected body).
 * `notFound` marks a refusal that means "no such customer" rather than an
 * outage. The message is for logs; the client gets a generic one.
 */
export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly notFound = false,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}
