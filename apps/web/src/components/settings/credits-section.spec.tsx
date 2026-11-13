// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';
import { ApiClientError } from '@chatofy/api-client';
import { balanceFixture, PLANS, SEPAY_ORDER, USAGE_PAGE } from './credits.fixture';

/**
 * "Credits & plan" on Settings › Billing: what it shows, and who may press what.
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
const buyButtons = () =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('[data-credit-buy-actions] button'));
const buyButton = (text: RegExp) => buyButtons().find((b) => text.test(accessibleName(b)));

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
  it('shows the total, the split, the reset date and the plan', async () => {
    await render();
    const text = container.textContent ?? '';
    expect(container.querySelector('[data-credit-total]')?.textContent).toBe('87.5 credits');
    expect(text).toContain('37.5 credits');
    expect(text).toContain('50 credits');
    expect(text).toContain('Reset on Dec 1, 2026');
    expect(text).toContain(en['common.billing.topupNeverExpire']);
    expect(text).toContain(en['common.billing.planFree']);
  });

  it('names each kind of credit in the legend, inside the group box rather than bordered', async () => {
    await render();
    const summary = container.querySelector('[data-credit-balance]');
    const terms = Array.from(summary?.querySelectorAll('dt') ?? []).map((dt) => dt.textContent);
    expect(terms).toEqual([en['common.billing.planCredits'], en['common.billing.topupCredits']]);
    // The box draws the divider under it; a border of its own doubled that line.
    expect(summary?.className).not.toMatch(/border/);
  });

  it('says where Pro came from, and offers the portal only for a card subscription', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ plan: 'pro', proSource: 'polar' }));
    await render();
    expect(container.textContent).toContain(en['common.billing.proSourcePolar']);
    expect(button(/Manage subscription/)).toBeDefined();
    act(() => root?.unmount());

    getCreditBalance.mockResolvedValue(balanceFixture({ plan: 'pro', proSource: 'sepay' }));
    await render();
    expect(container.textContent).toContain('VietQR pass, ends Dec 1, 2026');
    expect(button(/Manage subscription/)).toBeUndefined();
  });

  it('lists usage, linking a spend to its conversation', async () => {
    await render();
    const rows = container.querySelectorAll('[data-credit-usage-list] li');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain(en['common.billing.usageKind.translate']);
    expect(rows[0]?.textContent).toContain('−12.5 credits');
    expect(rows[0]?.querySelector('a')?.getAttribute('href')).toBe('/history/conv-1');
    expect(rows[1]?.textContent).toContain('+120 credits');
    expect(rows[1]?.querySelector('a')).toBeNull();
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
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
    });
    expect(listCreditUsage).toHaveBeenLastCalledWith('c-2');
    expect(container.querySelectorAll('[data-credit-usage-list] li')).toHaveLength(3);
    expect(button(/Show more/)).toBeUndefined();
  });

  it('disables every buy action for a closed account and says why', async () => {
    await render();
    const actions = Array.from(container.querySelectorAll('[data-credit-buy-actions] button'));
    // Pro by card, the VietQR pass, and one top-up on each rail.
    expect(actions).toHaveLength(4);
    const explanation = container.querySelector(`[data-credit-buy-actions] p`);
    expect(explanation?.textContent).toBe(en['common.billing.checkoutClosed']);
    for (const action of actions) {
      expect((action as HTMLButtonElement).disabled).toBe(true);
      expect(action.getAttribute('aria-describedby')).toBe(explanation?.id);
    }
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it('enables them for an allowlisted account, and says the rail is in test mode', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ checkoutAllowed: true }));
    await render();
    const actions = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-credit-buy-actions] button'),
    );
    expect(actions.every((action) => !action.disabled)).toBe(true);
    expect(actions.every((action) => !action.hasAttribute('aria-describedby'))).toBe(true);
    expect(container.textContent).not.toContain(en['common.billing.checkoutClosed']);
    expect(container.textContent).toContain(en['web.account.railSandboxCard']);
    expect(container.textContent).toContain(en['web.account.railSandboxQr']);
    expect(actions.map(accessibleName)).toEqual([
      'Buy Pro by card — $9.99 a month',
      'Buy Pro for 30 days by VietQR — ₫249,000',
      'Buy 250 credits by card — $5.00',
      'Buy 250 credits by VietQR — ₫125,000',
    ]);
  });

  it('fills the first offer only, whether or not checkout is open', async () => {
    // The tab's one accent-filled control, in both states that show offers.
    for (const checkoutAllowed of [false, true]) {
      getCreditBalance.mockResolvedValue(balanceFixture({ checkoutAllowed }));
      await render();
      expect(buyButtons().map((b) => b.getAttribute('data-variant'))).toEqual([
        'default',
        'outline',
        'outline',
        'outline',
      ]);
      act(() => root?.unmount());
    }
  });

  it('hides the actions of a rail this deployment reports unavailable', async () => {
    getCreditBalance.mockResolvedValue(
      balanceFixture({ checkoutAllowed: true, rails: { polar: 'unavailable', sepay: 'live' } }),
    );
    await render();
    expect(buyButtons().map(accessibleName)).toEqual([
      'Buy Pro for 30 days by VietQR — ₫249,000',
      'Buy 250 credits by VietQR — ₫125,000',
    ]);
    expect(container.querySelector('[data-rail-sandbox]')).toBeNull();
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

  it('opens the QR panel inline for a VietQR checkout', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ checkoutAllowed: true }));
    createCheckout.mockResolvedValue(SEPAY_ORDER);
    await render();
    await act(async () => {
      buyButton(/250 credits by VietQR/)?.click();
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
    });
    expect(createCheckout).toHaveBeenCalledWith({ planCode: 'topup_250', rail: 'sepay' });
    const panel = container.querySelector('[data-sepay-qr-panel]');
    expect(panel?.querySelector('img')?.getAttribute('src')).toBe(SEPAY_ORDER.qrUrl);
    expect(panel?.textContent).toContain('CHFABCD2345');
  });

  it('reports a refused checkout with the closed explanation, not a generic failure', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ checkoutAllowed: true }));
    createCheckout.mockRejectedValue(
      new ApiClientError({ code: 'CHECKOUT_NOT_OPEN', message: 'not open' }, 403),
    );
    await render();
    await act(async () => {
      buyButton(/Pro by card/)?.click();
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
    });
    expect(container.textContent).toContain(en['common.billing.checkoutClosed']);
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('reports any other checkout failure as a toast whose retry tries again', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ checkoutAllowed: true }));
    createCheckout.mockRejectedValue(new Error('network'));
    await render();
    await act(async () => {
      buyButton(/250 credits by VietQR/)?.click();
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
    });
    expect(notify.error).toHaveBeenCalledWith(
      en['web.account.checkoutFailed'],
      expect.objectContaining({ id: 'checkout' }),
    );
    expect(container.querySelector('[role=alert]')).toBeNull();

    createCheckout.mockResolvedValue(SEPAY_ORDER);
    await act(async () => {
      notify.error.mock.calls[0]?.[1]?.retry?.();
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
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
    expect(container.querySelector('[data-credit-buy-actions]')).toBeNull();
  });
});
