import { describe, expect, it } from 'vitest';
import { envSchema } from '../../../config/env.schema';
import {
  BILLING_ENV_KEYS,
  polarProductIds,
  railStatus,
  type BillingEnv,
} from './rail-status';

/** The billing env exactly as the schema would parse it from `raw`. */
function env(raw: Record<string, string> = {}): BillingEnv {
  const parsed = envSchema.parse({
    DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
    AUTH_JWT_SECRET: 'x'.repeat(32),
    ...raw,
  });
  return Object.fromEntries(
    BILLING_ENV_KEYS.map((key) => [key, parsed[key]]),
  ) as BillingEnv;
}

const polar = {
  POLAR_ACCESS_TOKEN: 'polar_oat_x',
  POLAR_WEBHOOK_SECRET: 'whsec_eA==',
};
const sepay = {
  SEPAY_WEBHOOK_SECRET: 'secret',
  SEPAY_BANK_ACCOUNT: '0123456789',
  SEPAY_BANK: 'MBBank',
};

describe('railStatus', () => {
  it('reports both rails unavailable with no billing keys at all', () => {
    expect(railStatus(env(), 'polar')).toBe('unavailable');
    expect(railStatus(env(), 'sepay')).toBe('unavailable');
  });

  it('defaults a configured rail to sandbox', () => {
    expect(railStatus(env({ ...polar, ...sepay }), 'polar')).toBe('sandbox');
    expect(railStatus(env({ ...polar, ...sepay }), 'sepay')).toBe('sandbox');
  });

  it('reports live only when the mode says so', () => {
    const live = env({
      ...polar,
      ...sepay,
      POLAR_MODE: 'live',
      SEPAY_MODE: 'live',
    });
    expect(railStatus(live, 'polar')).toBe('live');
    expect(railStatus(live, 'sepay')).toBe('live');
  });

  it('is unavailable when any one secret is missing, even in live mode', () => {
    for (const key of Object.keys(polar)) {
      expect(
        railStatus(env({ ...polar, [key]: '', POLAR_MODE: 'live' }), 'polar'),
      ).toBe('unavailable');
    }
    for (const key of Object.keys(sepay)) {
      expect(
        railStatus(env({ ...sepay, [key]: '', SEPAY_MODE: 'live' }), 'sepay'),
      ).toBe('unavailable');
    }
  });

  it('refuses a mode other than sandbox or live at boot', () => {
    expect(() => env({ POLAR_MODE: 'off' })).toThrow();
    expect(() => env({ SEPAY_MODE: 'test' })).toThrow();
  });
});

describe('POLAR_PRODUCT_IDS', () => {
  it('maps plan codes to product ids', () => {
    const ids = polarProductIds(
      env({ POLAR_PRODUCT_IDS: 'pro_monthly=prod_a,topup_250=prod_b' }),
    );
    expect(ids.get('pro_monthly')).toBe('prod_a');
    expect(ids.get('topup_250')).toBe('prod_b');
    expect(ids.size).toBe(2);
  });

  it('is empty when unset, and a malformed list fails at boot', () => {
    expect(polarProductIds(env()).size).toBe(0);
    expect(() => env({ POLAR_PRODUCT_IDS: 'pro_monthly' })).toThrow();
    expect(() =>
      env({ POLAR_PRODUCT_IDS: 'pro_monthly=a,,topup=b' }),
    ).toThrow();
  });
});
