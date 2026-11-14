import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Plan } from '@chatofy/types';

// `server-only` throws by design outside a server bundle; what it guards is the
// build, not this function's behaviour.
vi.mock('server-only', () => ({}));

const { PLANS_CACHE_MS, PLANS_FAILURE_CACHE_MS, clearPublicPlansCache, fetchPublicPlans } =
  await import('./fetch-public-plans');

const API = 'https://api.chatofy.example';

const PRO: Plan = {
  code: 'pro_monthly',
  kind: 'subscription',
  credits: 600,
  priceUsdCents: 999,
  priceVnd: null,
  periodDays: 30,
  rails: ['polar'],
};

const envelope = (data: unknown) => ({
  success: true,
  data,
  meta: { requestId: 'r1', timestamp: '2026-11-09T00:00:00.000Z' },
});

const answering = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(() => Promise.resolve(Response.json(body, { status })));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  clearPublicPlansCache();
});

/**
 * `/pricing` renders without prices on every failure, so the fetcher's whole contract
 * is "plans or null, never a throw": a throw here is a 500 on a public page.
 */
describe('fetchPublicPlans', () => {
  it('returns the plans from the envelope, asking the public endpoint uncached', async () => {
    const fetchImpl = answering(envelope({ plans: [PRO] }));
    await expect(fetchPublicPlans(fetchImpl, API)).resolves.toEqual([PRO]);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toEqual(new URL('/billing/plans', API));
    expect(init?.cache).toBe('no-store');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns null on a non-2xx answer', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = { success: false, error: { code: 'RATE_LIMITED', message: 'slow down' } };
    await expect(fetchPublicPlans(answering(body, 429), API)).resolves.toBeNull();
  });

  it('returns null when the body is not a plan list', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wrong = envelope({ plans: [{ ...PRO, kind: 'lifetime' }] });
    await expect(fetchPublicPlans(answering(wrong), API)).resolves.toBeNull();
  });

  it('returns null when the body is not JSON', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response('<html>')));
    await expect(fetchPublicPlans(fetchImpl, API)).resolves.toBeNull();
  });

  it('returns null when the API is unreachable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('fetch failed')));
    await expect(fetchPublicPlans(fetchImpl, API)).resolves.toBeNull();
  });

  it('serves renders within a minute from memory, then asks the API again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fetchImpl = answering(envelope({ plans: [PRO] }));
    await expect(fetchPublicPlans(fetchImpl, API)).resolves.toEqual([PRO]);
    vi.advanceTimersByTime(PLANS_CACHE_MS - 1);
    await expect(fetchPublicPlans(fetchImpl, API)).resolves.toEqual([PRO]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await expect(fetchPublicPlans(fetchImpl, API)).resolves.toEqual([PRO]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('remembers a failure briefly, so an outage costs one wait per window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const refused = answering({ success: false }, 429);
    await expect(fetchPublicPlans(refused, API)).resolves.toBeNull();

    const fetchImpl = answering(envelope({ plans: [PRO] }));
    vi.advanceTimersByTime(PLANS_FAILURE_CACHE_MS - 1);
    await expect(fetchPublicPlans(fetchImpl, API)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await expect(fetchPublicPlans(fetchImpl, API)).resolves.toEqual([PRO]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('remembers a failure for less time than a success', () => {
    expect(PLANS_FAILURE_CACHE_MS).toBeLessThan(PLANS_CACHE_MS);
  });

  it('gives up after the timeout instead of holding the page open', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A fetch that only ever settles by being aborted, as a hung API would.
    const hanging = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted', { cause: init.signal?.reason })),
          );
        }),
    );
    await expect(fetchPublicPlans(hanging, API, 20)).resolves.toBeNull();
  });
});
