import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../config/env.schema';
import type { PlanRow } from '../plan-catalog';
import { POLAR_API_BASE, PolarProvider } from './polar-provider';

// What the API asks Polar for: where a finished checkout and the customer portal
// send the reader back. Both must name the web's Settings › Billing page, the one
// place the return is read; a stale path here is a 404 after a payment.

const WEB = 'https://chatofy.example';

const env: Partial<Env> = {
  WEB_BASE_URL: WEB,
  POLAR_MODE: 'sandbox',
  POLAR_ACCESS_TOKEN: 'polar-token',
  POLAR_WEBHOOK_SECRET: 'polar-secret',
  POLAR_PRODUCT_IDS: 'pro_monthly=prod-1',
};
const config = {
  get: (key: keyof Env) => env[key],
} as unknown as ConfigService<Env, true>;

const pro: PlanRow = {
  code: 'pro_monthly',
  kind: 'subscription',
  credits: 600,
  priceUsdCents: 999,
  priceVnd: null,
  periodDays: 30,
  polar: true,
  sepay: false,
  active: true,
  sortOrder: 10,
};

function answer(body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sent(fetchMock: ReturnType<typeof answer>) {
  const [url, init] = fetchMock.mock.calls[0]!;
  // The provider always sends a JSON string body.
  const body = init?.body;
  if (typeof body !== 'string') throw new Error('expected a JSON string body');
  return { url, body: JSON.parse(body) as Record<string, unknown> };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PolarProvider', () => {
  it('returns a finished checkout to Settings › Billing with checkout=done', async () => {
    const fetchMock = answer({ url: 'https://polar.example/checkout/abc' });
    const provider = new PolarProvider(config);

    await expect(
      provider.createCheckout(
        { id: 'user-1', email: 'reader@example.com' },
        pro,
      ),
    ).resolves.toEqual({
      rail: 'polar',
      url: 'https://polar.example/checkout/abc',
    });
    const { url, body } = sent(fetchMock);
    expect(url).toBe(`${POLAR_API_BASE.sandbox}/checkouts/`);
    expect(body.success_url).toBe(`${WEB}/settings/billing?checkout=done`);
    expect(body.products).toEqual(['prod-1']);
  });

  it('returns the customer portal to Settings › Billing', async () => {
    const fetchMock = answer({
      customer_portal_url: 'https://polar.example/portal/xyz',
    });
    const provider = new PolarProvider(config);

    await expect(provider.createPortalUrl('user-1')).resolves.toBe(
      'https://polar.example/portal/xyz',
    );
    const { url, body } = sent(fetchMock);
    expect(url).toBe(`${POLAR_API_BASE.sandbox}/customer-sessions/`);
    expect(body.return_url).toBe(`${WEB}/settings/billing`);
    expect(body.external_customer_id).toBe('user-1');
  });
});
