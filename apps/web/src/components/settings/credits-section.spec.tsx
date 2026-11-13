// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';
import { ApiClientError } from '@chatofy/api-client';
import { balanceFixture, PLANS, SEPAY_ORDER, USAGE_PAGE } from './credits.fixture';

/**
 * Settings › Billing: what it shows, and who may press what.
 *
 * The eligibility half matters most. `checkoutAllowed` is the API's answer; a
 * page that enabled buying for everyone would send every visitor into a 403,
 * and one that disabled it silently would leave them guessing why. So a closed
 * account sees every action disabled AND described by the same sentence.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getCreditBalance = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const listCreditUsage = vi.hoisted(() => vi.fn<(cursor?: string) => Promise<unknown>>());
const listPlans = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const createCheckout = vi.hoisted(() => vi.fn<(body: unknown) => Promise<unknown>>());
const getCheckoutOrder = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const getBillingPortal = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock('@/clients/api-client', () => ({
  getCreditBalance: () => getCreditBalance(),
  listCreditUsage: (cursor?: string) => listCreditUsage(cursor),
  listPlans: () => listPlans(),
  createCheckout: (body: unknown) => createCheckout(body),
  getCheckoutOrder: () => getCheckoutOrder(),
  getBillingPortal: () => getBillingPortal(),
}));

const notify = vi.hoisted(() => ({
  success: vi.fn<(message: string, options?: { id?: string }) => void>(),
  error: vi.fn<(message: string, options?: { id?: string; retry?: () => void }) => void>(),
  dismiss: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify }));

// The address Billing was opened at; a case sets it to the Polar return.
const url = vi.hoisted(() => ({ query: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(url.query) }));

const { CreditsSection } = await import('./credits-section');
const { LocaleProvider } = await import('@/i18n/provider');

let root: Root | undefined;
let container: HTMLElement;

async function render(): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <CreditsSection />
      </LocaleProvider>,
    );
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

const buttons = () => Array.from(container.querySelectorAll('button'));
const button = (text: RegExp) => buttons().find((b) => text.test(b.textContent ?? ''));
/** What a screen reader calls a button: its `aria-labelledby` targets, in order. */
const accessibleName = (el: Element) =>
  (el.getAttribute('aria-labelledby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
/** Every Upgrade and Buy, in page order: the plan columns, then the top-up tiles. */
const buyButtons = () =>
  Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      '[data-credit-plans] button[aria-labelledby], [data-credit-topups] li button',
    ),
  );
const buyButton = (text: RegExp) => buyButtons().find((b) => text.test(accessibleName(b)));
const planColumn = (id: 'free' | 'pro') => container.querySelector(`[data-plan-column="${id}"]`);
const method = (rail: 'polar' | 'sepay') =>
  container.querySelector<HTMLButtonElement>(`[data-credit-topups] [data-value="${rail}"]`);
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  getCreditBalance.mockResolvedValue(balanceFixture());
  listCreditUsage.mockResolvedValue(USAGE_PAGE);
  listPlans.mockResolvedValue({ plans: PLANS });
  getCheckoutOrder.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.clearAllMocks();
  url.query = '';
});

describe('the credits region', () => {
  it('shows the total, the split and the reset date', async () => {
    await render();
    const text = container.textContent ?? '';
    expect(container.querySelector('[data-credit-total]')?.textContent).toBe('87.5 credits');
    expect(text).toContain('37.5 credits');
    expect(text).toContain('50 credits');
    expect(text).toContain('Reset on Dec 1, 2026');
    expect(text).toContain(en['common.billing.topupNeverExpire']);
  });

  it('names each kind of credit in the legend, inside the group box rather than bordered', async () => {
    await render();
    const summary = container.querySelector('[data-credit-balance]');
    const terms = Array.from(summary?.querySelectorAll('dt') ?? []).map((dt) => dt.textContent);
    expect(terms).toEqual([en['common.billing.planCredits'], en['common.billing.topupCredits']]);
    // The box draws the divider under it; a border of its own doubled that line.
    expect(summary?.className).not.toMatch(/border/);
  });
});

describe('the plan comparison', () => {
  it('sets Free beside Pro at the numbers the API answers, and marks Free as yours', async () => {
    await render();
    const free = planColumn('free')?.textContent ?? '';
    expect(free).toContain('$0.00 a month');
    expect(free).toContain('120 credits every month');
    expect(free).toContain(en['web.billing.featureNoCarryOver']);
    const pro = planColumn('pro')?.textContent ?? '';
    expect(pro).toContain('$9.99 a month by card');
    expect(pro).toContain('₫249,000 for 30 days by VietQR');
    expect(pro).toContain('600 credits each cycle');
    expect(pro).toContain(en['web.billing.featurePayOptions']);
    // Same structure on both sides, so the parts line up across.
    for (const id of ['free', 'pro'] as const) {
      expect(planColumn(id)?.querySelectorAll('li').length).toBeGreaterThanOrEqual(3);
    }
    // On the pane ground: no group box drawn around the bordered columns or tiles.
    expect(planColumn('free')?.closest('[data-slot="settings-section-box"]')).toBeNull();
    expect(
      container
        .querySelector('[data-credit-topups] li')
        ?.closest('[data-slot="settings-section-box"]'),
    ).toBeNull();
    expect(planColumn('free')?.hasAttribute('data-current-plan')).toBe(true);
    expect(planColumn('free')?.textContent).toContain(en['web.billing.yourPlan']);
    expect(planColumn('pro')?.hasAttribute('data-current-plan')).toBe(false);
    // The old lone plan badge row is gone: the columns say it.
    expect(container.querySelector('[data-slot="badge"]')).toBeNull();
  });

  it('marks Pro by card with its renewal date and Manage, and offers no Upgrade', async () => {
    getCreditBalance.mockResolvedValue(
      balanceFixture({ plan: 'pro', proSource: 'polar', checkoutAllowed: true }),
    );
    await render();
    const pro = planColumn('pro');
    expect(pro?.hasAttribute('data-current-plan')).toBe(true);
    expect(pro?.textContent).toContain('Card subscription, renews on Dec 1, 2026');
    expect(button(/Manage subscription/)).toBeDefined();
    expect(button(/Upgrade/)).toBeUndefined();
  });

  it('marks a VietQR pass with its end date, without Manage or Upgrade', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ plan: 'pro', proSource: 'sepay' }));
    await render();
    expect(planColumn('pro')?.textContent).toContain('VietQR pass, ends Dec 1, 2026');
    expect(button(/Manage subscription/)).toBeUndefined();
    expect(button(/Upgrade/)).toBeUndefined();
  });

  it('opens the billing portal from Manage, and toasts with Retry when it will not open', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ plan: 'pro', proSource: 'polar' }));
    getBillingPortal.mockRejectedValue(new Error('offline'));
    await render();
    await act(async () => {
      button(/Manage subscription/)?.click();
      await settle();
    });
    expect(notify.error).toHaveBeenCalledWith(
      en['web.account.checkoutFailed'],
      expect.objectContaining({ id: 'billing-portal' }),
    );
  });

  it('says the prices are unavailable when the plans cannot be read', async () => {
    listPlans.mockRejectedValue(new Error('503'));
    await render();
    expect(container.textContent).toContain(en['web.pricing.pricesUnavailable']);
    expect(planColumn('free')?.hasAttribute('data-current-plan')).toBe(true);
    expect(container.querySelector('[data-credit-topups]')).toBeNull();
  });
});

describe('usage', () => {
  it('lists usage by day, linking a spend to its conversation', async () => {
    await render();
    const days = container.querySelectorAll('[data-usage-day]');
    expect(Array.from(days, (day) => day.querySelector('h4')?.textContent)).toEqual([
      'Nov 9, 2026',
      'Nov 1, 2026',
    ]);
    const rows = container.querySelectorAll('[data-credit-usage-list] li');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain(en['common.billing.usageKind.translate']);
    expect(rows[0]?.textContent).toContain('−12.5 credits');
    expect(rows[0]?.querySelector('a')?.getAttribute('href')).toBe('/history/conv-1');
    expect(rows[0]?.querySelector('svg')).not.toBeNull();
    expect(rows[1]?.textContent).toContain('+120 credits');
    expect(rows[1]?.textContent).toContain('Free monthly credits');
    expect(rows[1]?.querySelector('a')).toBeNull();
  });

  it('draws a spend in the plain foreground and an addition in the quiet green', async () => {
    await render();
    const amounts = Array.from(
      container.querySelectorAll('[data-credit-usage-list] li'),
      (row) => row.querySelector('.tabular-nums.font-medium')?.className ?? '',
    );
    expect(amounts[0]).not.toMatch(/text-(speaking|live|destructive)/);
    expect(amounts[1]).toMatch(/text-speaking/);
  });

  it('heads today and yesterday by name', async () => {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
    listCreditUsage.mockResolvedValue({
      ...USAGE_PAGE,
      entries: [
        { ...USAGE_PAGE.entries[0]!, at: now.toISOString() },
        { ...USAGE_PAGE.entries[1]!, at: yesterday.toISOString() },
      ],
    });
    await render();
    expect(
      Array.from(container.querySelectorAll('[data-usage-day] h4'), (h) => h.textContent),
    ).toEqual([en['web.billing.usageToday'], en['web.billing.usageYesterday']]);
  });

  it('pages older usage with the cursor', async () => {
    listCreditUsage.mockImplementation((cursor) =>
      Promise.resolve(
        cursor
          ? { ...USAGE_PAGE, entries: [{ ...USAGE_PAGE.entries[1]!, id: 'e-3' }], nextCursor: null }
          : { ...USAGE_PAGE, nextCursor: 'c-2' },
      ),
    );
    await render();
    await act(async () => {
      button(/Show more/)?.click();
      await settle();
    });
    expect(listCreditUsage).toHaveBeenLastCalledWith('c-2');
    expect(container.querySelectorAll('[data-credit-usage-list] li')).toHaveLength(3);
    expect(button(/Show more/)).toBeUndefined();
  });
});

describe('buying', () => {
  it('disables every Upgrade and Buy for a closed account and says why, once', async () => {
    await render();
    const actions = buyButtons();
    // Upgrade by card and by VietQR, and three top-up packs.
    expect(actions).toHaveLength(5);
    const explanations = Array.from(container.querySelectorAll('p')).filter(
      (p) => p.textContent === en['common.billing.checkoutClosed'],
    );
    expect(explanations).toHaveLength(1);
    for (const action of actions) {
      expect(action.disabled).toBe(true);
      expect(action.getAttribute('aria-describedby')).toBe(explanations[0]?.id);
      expect(action.getAttribute('data-variant')).toBe('outline');
    }
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it('enables them for an allowlisted account, and says payments are in test mode', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ checkoutAllowed: true }));
    await render();
    const actions = buyButtons();
    expect(actions.every((action) => !action.disabled)).toBe(true);
    expect(actions.every((action) => !action.hasAttribute('aria-describedby'))).toBe(true);
    expect(container.textContent).not.toContain(en['common.billing.checkoutClosed']);
    expect(container.textContent).toContain(en['web.billing.railSandboxBoth']);
    expect(actions.map(accessibleName)).toEqual([
      'Upgrade by card Pro by card — $9.99 a month',
      'Upgrade by VietQR Pro for 30 days by VietQR — ₫249,000',
      'Buy 250 credits by card — $5.00',
      'Buy 550 credits by card — $10.00',
      'Buy 1,500 credits by card — $25.00',
    ]);
  });

  it('fills Upgrade by card only, and nothing for Pro or a closed account', async () => {
    for (const [over, first] of [
      [{ checkoutAllowed: true }, 'default'],
      [{ checkoutAllowed: false }, 'outline'],
    ] as const) {
      getCreditBalance.mockResolvedValue(balanceFixture(over));
      await render();
      expect(buyButtons().map((b) => b.getAttribute('data-variant'))).toEqual([
        first,
        'outline',
        'outline',
        'outline',
        'outline',
      ]);
      act(() => root?.unmount());
    }
    getCreditBalance.mockResolvedValue(
      balanceFixture({ checkoutAllowed: true, plan: 'pro', proSource: 'sepay' }),
    );
    await render();
    expect(container.querySelector('[data-slot="button"][data-variant="default"]')).toBeNull();
  });

  it('prices the packs in the payment method chosen once above them', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ checkoutAllowed: true }));
    await render();
    expect(method('polar')?.getAttribute('aria-checked')).toBe('true');
    await act(async () => {
      method('sepay')?.click();
      await settle();
    });
    expect(method('sepay')?.getAttribute('aria-checked')).toBe('true');
    const tiles = container.querySelectorAll('[data-credit-topups] li');
    expect(Array.from(tiles, (tile) => tile.getAttribute('data-topup-pack'))).toEqual([
      'topup_250',
      'topup_550',
      'topup_1500',
    ]);
    expect(tiles[0]?.textContent).toContain('₫125,000');
    expect(buyButton(/1,500 credits by VietQR/)).toBeDefined();
  });

  it('disables a method whose rail is unavailable, and drops its Upgrade', async () => {
    getCreditBalance.mockResolvedValue(
      balanceFixture({ checkoutAllowed: true, rails: { polar: 'unavailable', sepay: 'live' } }),
    );
    await render();
    expect(method('polar')?.disabled).toBe(true);
    expect(method('sepay')?.getAttribute('aria-checked')).toBe('true');
    expect(buyButtons().map(accessibleName)).toEqual([
      'Upgrade by VietQR Pro for 30 days by VietQR — ₫249,000',
      'Buy 250 credits by VietQR — ₫125,000',
      'Buy 550 credits by VietQR — ₫250,000',
      'Buy 1,500 credits by VietQR — ₫625,000',
    ]);
    // The one Upgrade left is the filled control.
    expect(buyButtons()[0]?.getAttribute('data-variant')).toBe('default');
    expect(container.querySelector('[data-rail-sandbox]')).toBeNull();
  });

  it('leaves the top-up group out when no rail can sell a pack', async () => {
    getCreditBalance.mockResolvedValue(
      balanceFixture({
        checkoutAllowed: true,
        rails: { polar: 'unavailable', sepay: 'unavailable' },
      }),
    );
    await render();
    expect(container.querySelector('[data-credit-topups]')).toBeNull();
    expect(button(/Upgrade/)).toBeUndefined();
  });

  it('says only the sandbox rail is in test mode when the other one charges real money', async () => {
    getCreditBalance.mockResolvedValue(
      balanceFixture({ checkoutAllowed: true, rails: { polar: 'sandbox', sepay: 'live' } }),
    );
    await render();
    const hints = Array.from(container.querySelectorAll('[data-rail-sandbox]'));
    expect(hints.map((hint) => hint.getAttribute('data-rail-sandbox'))).toEqual(['polar']);
    expect(hints[0]?.textContent).toBe(en['web.account.railSandboxCard']);
    expect(container.textContent).not.toContain(en['web.account.railSandboxQr']);
  });

  it('opens the QR panel under the packs for a VietQR top-up', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ checkoutAllowed: true }));
    createCheckout.mockResolvedValue(SEPAY_ORDER);
    await render();
    await act(async () => {
      method('sepay')?.click();
      await settle();
    });
    await act(async () => {
      buyButton(/250 credits by VietQR/)?.click();
      await settle();
    });
    expect(createCheckout).toHaveBeenCalledWith({ planCode: 'topup_250', rail: 'sepay' });
    const panel = container.querySelector('[data-credit-topups] [data-sepay-qr-panel]');
    expect(panel?.querySelector('img')?.getAttribute('src')).toBe(SEPAY_ORDER.qrUrl);
    expect(panel?.textContent).toContain('CHFABCD2345');
  });

  it('opens the QR panel in the plan group for Upgrade by VietQR', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ checkoutAllowed: true }));
    createCheckout.mockResolvedValue({ ...SEPAY_ORDER, amountVnd: 249000 });
    await render();
    await act(async () => {
      button(/Upgrade by VietQR/)?.click();
      await settle();
    });
    expect(createCheckout).toHaveBeenCalledWith({ planCode: 'pro_pass_30d', rail: 'sepay' });
    expect(container.querySelector('[data-credit-topups] [data-sepay-qr-panel]')).toBeNull();
    expect(container.querySelector('[data-sepay-qr-panel]')).not.toBeNull();
  });

  it('reports a refused checkout with the closed explanation, not a generic failure', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ checkoutAllowed: true }));
    createCheckout.mockRejectedValue(
      new ApiClientError({ code: 'CHECKOUT_NOT_OPEN', message: 'not open' }, 403),
    );
    await render();
    await act(async () => {
      button(/Upgrade by card/)?.click();
      await settle();
    });
    expect(container.textContent).toContain(en['common.billing.checkoutClosed']);
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('reports any other checkout failure as a toast whose retry tries again', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ checkoutAllowed: true }));
    createCheckout.mockRejectedValue(new Error('network'));
    await render();
    await act(async () => {
      method('sepay')?.click();
      await settle();
    });
    await act(async () => {
      buyButton(/250 credits by VietQR/)?.click();
      await settle();
    });
    expect(notify.error).toHaveBeenCalledWith(
      en['web.account.checkoutFailed'],
      expect.objectContaining({ id: 'checkout' }),
    );
    expect(container.querySelector('[role=alert]')).toBeNull();

    createCheckout.mockResolvedValue(SEPAY_ORDER);
    await act(async () => {
      notify.error.mock.calls[0]?.[1]?.retry?.();
      await settle();
    });
    expect(createCheckout).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-sepay-qr-panel]')).not.toBeNull();
  });

  it('reads the balance again after coming back from Polar', async () => {
    vi.useFakeTimers();
    try {
      url.query = 'checkout=done';
      await render();
      expect(notify.success).toHaveBeenCalledWith(en['web.account.checkoutReturned'], {
        id: 'checkout-returned',
      });
      expect(getCreditBalance).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(getCreditBalance).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the page usable when the balance cannot be read', async () => {
    getCreditBalance.mockRejectedValue(new Error('503'));
    await render();
    expect(container.textContent).toContain(en['common.billing.loadFailed']);
    expect(container.querySelector('[data-credit-plans]')).toBeNull();
    expect(container.querySelector('[data-credit-topups]')).toBeNull();
  });
});
