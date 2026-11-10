import type { ConfigService } from '@nestjs/config';
import type { PaymentRail, RailStatus } from '@chatofy/types';
import type { Env } from '../../../config/env.schema';

/** The env keys the payment rails read; everything else stays out of reach. */
export const BILLING_ENV_KEYS = [
  'WEB_BASE_URL',
  'BILLING_CHECKOUT_ALLOWLIST',
  'POLAR_MODE',
  'POLAR_ACCESS_TOKEN',
  'POLAR_WEBHOOK_SECRET',
  'POLAR_PRODUCT_IDS',
  'SEPAY_MODE',
  'SEPAY_WEBHOOK_SECRET',
  'SEPAY_BANK_ACCOUNT',
  'SEPAY_BANK',
  'SEPAY_ORDER_PREFIX',
] as const;

export type BillingEnv = Pick<Env, (typeof BILLING_ENV_KEYS)[number]>;

/** Reads the billing keys out of the validated config once. */
export function readBillingEnv(config: ConfigService<Env, true>): BillingEnv {
  const env: Partial<Record<keyof BillingEnv, unknown>> = {};
  for (const key of BILLING_ENV_KEYS)
    env[key] = config.get(key, { infer: true });
  return env as BillingEnv;
}

/**
 * Where a rail stands on this deployment.
 *
 * A rail is `unavailable` when any secret it needs to both take a payment and
 * verify the provider's webhook is missing: a checkout the webhook could never
 * confirm would take money and grant nothing. Otherwise it reports its mode, so
 * a client can label a sandbox purchase as a test.
 */
export function railStatus(env: BillingEnv, rail: PaymentRail): RailStatus {
  if (rail === 'polar') {
    return env.POLAR_ACCESS_TOKEN && env.POLAR_WEBHOOK_SECRET
      ? env.POLAR_MODE
      : 'unavailable';
  }
  return env.SEPAY_WEBHOOK_SECRET && env.SEPAY_BANK_ACCOUNT && env.SEPAY_BANK
    ? env.SEPAY_MODE
    : 'unavailable';
}

export function railStatuses(env: BillingEnv): Record<PaymentRail, RailStatus> {
  return { polar: railStatus(env, 'polar'), sepay: railStatus(env, 'sepay') };
}

/**
 * `POLAR_PRODUCT_IDS` as plan code → product id. The schema has already
 * checked the `code=id,code=id` shape, so this only splits it.
 */
export function polarProductIds(env: BillingEnv): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  if (!env.POLAR_PRODUCT_IDS) return map;
  for (const pair of env.POLAR_PRODUCT_IDS.split(',')) {
    const [code, id] = pair.split('=');
    if (code && id) map.set(code, id);
  }
  return map;
}
