// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';
import { SEPAY_ORDER } from './credits.fixture';

/**
 * The VietQR panel: the code is readable as text, the outcome is announced, and
 * the poll ends — at a settled status, or when the panel goes away. A poll that
 * outlived its panel would ask about an order every 3 s for the rest of the visit.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getCheckoutOrder = vi.hoisted(() => vi.fn<(id: string) => Promise<unknown>>());
vi.mock('@/clients/api-client', () => ({
  getCheckoutOrder: (id: string) => getCheckoutOrder(id),
}));

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
vi.mock('@/lib/notify', () => ({ notify }));

const { SepayQrPanel } = await import('./sepay-qr-panel');
const { LocaleProvider } = await import('@/i18n/provider');
const { EXPIRED_ORDER_POLL_MS } = await import('@/hooks/use-credits');

let root: Root | undefined;
let container: HTMLElement;
const onPaid = vi.fn();
const onClose = vi.fn();

const order = (status: string) => ({
  id: SEPAY_ORDER.orderId,
  status,
  planCode: 'topup_250',
  amountVnd: SEPAY_ORDER.amountVnd,
  expiresAt: SEPAY_ORDER.expiresAt,
  paidAt: status === 'paid' ? '2026-11-09T08:40:00.000Z' : null,
});

async function render(): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <SepayQrPanel order={SEPAY_ORDER} onPaid={onPaid} onClose={onClose} />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
}

/** One poll period, with the answer it fetched landing inside the same act. */
async function tick(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
}

const status = () => container.querySelector('[data-qr-status]');

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('SepayQrPanel', () => {
  it('shows the QR with the amount and transfer note as text, in a polite live region', async () => {
    getCheckoutOrder.mockResolvedValue(order('pending'));
    await render();
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(SEPAY_ORDER.qrUrl);
    expect(img?.getAttribute('alt')).toContain('₫125,000');
    expect(container.textContent).toContain('CHFABCD2345');
    expect(container.textContent).toContain(en['web.account.qrCodeHint']);
    expect(status()?.getAttribute('aria-live')).toBe('polite');
    expect(status()?.textContent).toBe(en['web.account.qrWaiting']);
    // Not an elevated surface: the screen's one is the security panel.
    expect(container.querySelector('[data-slot="card"]')).toBeNull();
  });

  it('polls every 3 s until paid, then stops and refetches the balance', async () => {
    getCheckoutOrder.mockResolvedValueOnce(order('pending')).mockResolvedValue(order('paid'));
    await render();
    expect(getCheckoutOrder).not.toHaveBeenCalled();
    await tick();
    expect(getCheckoutOrder).toHaveBeenCalledTimes(1);
    expect(onPaid).not.toHaveBeenCalled();
    await tick();
    expect(getCheckoutOrder).toHaveBeenCalledTimes(2);
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(status()?.textContent).toBe(en['web.account.qrPaid']);
    await tick();
    await tick();
    expect(getCheckoutOrder).toHaveBeenCalledTimes(2);
  });

  it('says an expired order has expired, and keeps watching, slower, for a late transfer', async () => {
    getCheckoutOrder.mockResolvedValueOnce(order('expired')).mockResolvedValue(order('paid'));
    await render();
    await tick();
    expect(status()?.textContent).toBe(en['web.account.qrExpired']);
    await tick();
    expect(getCheckoutOrder).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXPIRED_ORDER_POLL_MS);
    });
    expect(getCheckoutOrder).toHaveBeenCalledTimes(2);
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(status()?.textContent).toBe(en['web.account.qrPaid']);
  });

  it('says a transfer held for review will be credited by hand, and stops', async () => {
    getCheckoutOrder.mockResolvedValue(order('needs_review'));
    await render();
    await tick();
    expect(status()?.textContent).toBe(en['web.account.qrNeedsReview']);
    await tick();
    expect(getCheckoutOrder).toHaveBeenCalledTimes(1);
    expect(onPaid).not.toHaveBeenCalled();
  });

  it('keeps polling through a failed poll', async () => {
    getCheckoutOrder
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(order('pending'));
    await render();
    await tick();
    await tick();
    expect(getCheckoutOrder).toHaveBeenCalledTimes(2);
    expect(status()?.textContent).toBe(en['web.account.qrWaiting']);
  });

  it('stops polling when it is closed', async () => {
    getCheckoutOrder.mockResolvedValue(order('pending'));
    await render();
    await tick();
    expect(getCheckoutOrder).toHaveBeenCalledTimes(1);
    act(() => root?.unmount());
    root = undefined;
    await vi.advanceTimersByTimeAsync(9000);
    expect(getCheckoutOrder).toHaveBeenCalledTimes(1);
  });

  it('closes through a ghost control, spending no accent', async () => {
    getCheckoutOrder.mockResolvedValue(order('pending'));
    await render();
    const close = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === en['web.account.qrClose'],
    );
    expect(close?.getAttribute('data-variant')).toBe('ghost');
    act(() => close?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('copies the transfer note and confirms with a toast, leaving the button saying Copy', async () => {
    getCheckoutOrder.mockResolvedValue(order('pending'));
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await render();
    const copies = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent === en['web.account.qrCopy'],
    );
    await act(async () => {
      copies[1]?.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(SEPAY_ORDER.orderCode);
    expect(notify.success).toHaveBeenCalledWith(en['web.account.qrCopied'], { id: 'sepay-copy' });
    expect(copies[1]?.textContent).toBe(en['web.account.qrCopy']);
  });
});
