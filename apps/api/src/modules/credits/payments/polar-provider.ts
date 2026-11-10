import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CheckoutResponse, RailStatus } from '@chatofy/types';
import { z } from 'zod';
import type { Env } from '../../../config/env.schema';
import type { PlanRow } from '../plan-catalog';
import {
  PaymentProviderError,
  type CheckoutUser,
  type PaymentProvider,
} from './payment-provider';
import {
  polarProductIds,
  railStatus,
  readBillingEnv,
  type BillingEnv,
} from './rail-status';

/** Polar's REST base per mode; the token and webhook secret must match it. */
export const POLAR_API_BASE = {
  sandbox: 'https://sandbox-api.polar.sh/v1',
  live: 'https://api.polar.sh/v1',
} as const;

/** Bounds every call to Polar so a slow provider cannot hold a request open. */
const POLAR_TIMEOUT_MS = 10_000;

const checkoutBodySchema = z.object({ url: z.url() });
const customerSessionBodySchema = z.object({ customer_portal_url: z.url() });

/**
 * Polar: hosted checkout for the Pro subscription and USD top-ups, and the
 * customer portal where a subscription is cancelled.
 *
 * One `fetch` per call rather than the SDK: the stable SDK's webhook helper
 * cannot verify secrets made after Polar's 2026 scheme change and throws on
 * event types it does not know, and these two calls are all the API needs.
 */
@Injectable()
export class PolarProvider implements PaymentProvider {
  readonly rail = 'polar' as const;
  private readonly env: BillingEnv;
  private readonly productIds: ReadonlyMap<string, string>;

  constructor(config: ConfigService<Env, true>) {
    this.env = readBillingEnv(config);
    this.productIds = polarProductIds(this.env);
  }

  status(): RailStatus {
    return railStatus(this.env, 'polar');
  }

  offers(plan: PlanRow): boolean {
    return (
      plan.active &&
      plan.polar &&
      this.productIds.has(plan.code) &&
      this.status() !== 'unavailable'
    );
  }

  /** The plan a Polar product id was configured for; how an order names its plan. */
  planCodeForProduct(productId: string | null | undefined): string | null {
    if (!productId) return null;
    for (const [code, id] of this.productIds) if (id === productId) return code;
    return null;
  }

  async createCheckout(
    user: CheckoutUser,
    plan: PlanRow,
  ): Promise<CheckoutResponse> {
    const productId = this.productIds.get(plan.code);
    if (!productId) {
      throw new PaymentProviderError(`no Polar product for ${plan.code}`);
    }
    // `external_customer_id` ties the Polar customer to this account, and the
    // webhook requires the order's customer to carry it AND to match
    // `metadata.userId`: an order from a link made outside this route grants nothing.
    const body = await this.post('/checkouts/', {
      products: [productId],
      external_customer_id: user.id,
      metadata: { userId: user.id, planCode: plan.code },
      success_url: `${this.env.WEB_BASE_URL}/account?checkout=done`,
    });
    const parsed = checkoutBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new PaymentProviderError('Polar checkout response had no url');
    }
    return { rail: 'polar', url: parsed.data.url };
  }

  /** A short-lived customer-portal link for the account (cancel, card, invoices). */
  async createPortalUrl(userId: string): Promise<string> {
    const body = await this.post('/customer-sessions/', {
      external_customer_id: userId,
      return_url: `${this.env.WEB_BASE_URL}/account`,
    });
    const parsed = customerSessionBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new PaymentProviderError(
        'Polar customer session had no portal url',
      );
    }
    return parsed.data.customer_portal_url;
  }

  private async post(path: string, payload: unknown): Promise<unknown> {
    const token = this.env.POLAR_ACCESS_TOKEN;
    if (!token) throw new PaymentProviderError('Polar is not configured');
    let response: Response;
    try {
      response = await fetch(`${POLAR_API_BASE[this.env.POLAR_MODE]}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(POLAR_TIMEOUT_MS),
      });
    } catch (err) {
      throw new PaymentProviderError(
        `Polar ${path} unreachable: ${String(err)}`,
      );
    }
    if (!response.ok) {
      // The body may echo request data; only the status is logged.
      throw new PaymentProviderError(
        `Polar ${path} answered ${response.status}`,
        response.status === 404 || response.status === 422,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new PaymentProviderError(`Polar ${path} answered non-JSON`);
    }
  }
}
