// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { balanceFixture, USAGE_PAGE } from '@/components/settings/credits.fixture';
import {
  AUTO_REFRESH_WINDOW_MS,
  CreditBalanceProvider,
  EXPIRED_ORDER_POLL_MS,
  EXPIRED_ORDER_POLLS,
  ORDER_POLL_MS,
  useCheckoutOrder,
  useCreditBalance,
  useCreditUsage,
  useRefreshCreditBalance,
  type UseCreditBalance,
  type UseCreditUsage,
} from './use-credits';

/**
 * The three credit reads. What each must not do is as important as what it
 * does: a stale read must not overwrite a fresh one, a "Show more" from an old
 * list must not append to a new one, and a poll must end.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getCreditBalance = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const listCreditUsage = vi.hoisted(() => vi.fn<(cursor?: string) => Promise<unknown>>());
const getCheckoutOrder = vi.hoisted(() => vi.fn<(id: string) => Promise<unknown>>());
vi.mock('@/clients/api-client', () => ({
  getCreditBalance: () => getCreditBalance(),
  listCreditUsage: (cursor?: string) => listCreditUsage(cursor),
  getCheckoutOrder: (id: string) => getCheckoutOrder(id),
}));

const pathname = vi.hoisted(() => vi.fn(() => '/translate/one-way'));
vi.mock('next/navigation', () => ({ usePathname: () => pathname() }));

let root: Root;
let container: HTMLElement;
let balance: UseCreditBalance;
let usage: UseCreditUsage;
let order: ReturnType<typeof useCheckoutOrder>;

function Probe({ orderId, onSettled }: { orderId: string | null; onSettled?: () => void }) {
  const b = useCreditBalance();
  const u = useCreditUsage();
  const o = useCheckoutOrder(orderId, onSettled);
  React.useEffect(() => {
    balance = b;
    usage = u;
    order = o;
  });
  return null;
}

async function mount(orderId: string | null = null, onSettled?: () => void) {
  await act(async () => {
    root.render(<Probe orderId={orderId} onSettled={onSettled} />);
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getCreditBalance.mockResolvedValue(balanceFixture());
  listCreditUsage.mockResolvedValue(USAGE_PAGE);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('useCreditBalance', () => {
  it('reads the balance on mount', async () => {
    await mount();
    expect(balance.state).toBe('ready');
    expect(balance.balance?.totalCredits).toBe(87.5);
  });

  it('reports a failed read, and keeps the last balance through a failed refetch', async () => {
    getCreditBalance.mockRejectedValueOnce(new Error('503'));
    await mount();
    expect(balance.state).toBe('failed');
    expect(balance.balance).toBeNull();

    await act(() => balance.refresh());
    expect(balance.state).toBe('ready');
    getCreditBalance.mockRejectedValueOnce(new Error('503'));
    await act(() => balance.refresh());
    expect(balance.state).toBe('failed');
    expect(balance.balance?.totalCredits).toBe(87.5);
  });

  it('lets the newest read win over a slower earlier one', async () => {
    let slow: (value: unknown) => void = () => {};
    getCreditBalance.mockReturnValueOnce(new Promise((resolve) => (slow = resolve)));
    await mount();
    getCreditBalance.mockResolvedValueOnce(balanceFixture({ totalCredits: 337.5 }));
    await act(() => balance.refresh());
    slow(balanceFixture({ totalCredits: 1 }));
    await flush();
    expect(balance.balance?.totalCredits).toBe(337.5);
  });
});

describe('CreditBalanceProvider', () => {
  const readers: Record<string, UseCreditBalance> = {};
  let refreshOnly: () => Promise<void> = () => Promise.resolve();

  function Reader({ name }: { name: string }) {
    const b = useCreditBalance();
    React.useEffect(() => {
      readers[name] = b;
    });
    return null;
  }

  function Refresher() {
    const refresh = useRefreshCreditBalance();
    React.useEffect(() => {
      refreshOnly = refresh;
    });
    return null;
  }

  const shell = () => (
    <CreditBalanceProvider>
      <Reader name="sidebar" />
      <Reader name="billing" />
      <Refresher />
    </CreditBalanceProvider>
  );

  async function mountShell() {
    await act(async () => {
      root.render(shell());
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
    });
  }

  // The clock the freshness window reads; a row moves it past the window when it
  // wants an automatic read to happen.
  let now = 1_000_000;
  const pastTheWindow = () => {
    now += AUTO_REFRESH_WINDOW_MS + 1;
  };

  beforeEach(() => {
    pathname.mockReturnValue('/translate/one-way');
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.mocked(Date.now).mockRestore();
  });

  it('reads once for every reader under it', async () => {
    await mountShell();
    expect(getCreditBalance).toHaveBeenCalledTimes(1);
    expect(readers.sidebar?.balance?.totalCredits).toBe(87.5);
    expect(readers.billing?.balance?.totalCredits).toBe(87.5);
  });

  it('updates every reader from one refresh, whoever asks', async () => {
    await mountShell();
    getCreditBalance.mockResolvedValueOnce(balanceFixture({ totalCredits: 337.5 }));
    await act(() => readers.billing!.refresh());
    expect(getCreditBalance).toHaveBeenCalledTimes(2);
    expect(readers.sidebar?.balance?.totalCredits).toBe(337.5);
    expect(readers.billing?.balance?.totalCredits).toBe(337.5);

    getCreditBalance.mockResolvedValueOnce(balanceFixture({ totalCredits: 12 }));
    await act(() => refreshOnly());
    expect(getCreditBalance).toHaveBeenCalledTimes(3);
    expect(readers.sidebar?.balance?.totalCredits).toBe(12);
  });

  it('reads again on navigation, and not on a re-render of the same route', async () => {
    await mountShell();
    await mountShell();
    expect(getCreditBalance).toHaveBeenCalledTimes(1);

    getCreditBalance.mockResolvedValueOnce(balanceFixture({ totalCredits: 50 }));
    pastTheWindow();
    pathname.mockReturnValue('/settings/billing');
    await mountShell();
    expect(getCreditBalance).toHaveBeenCalledTimes(2);
    expect(readers.sidebar?.balance?.totalCredits).toBe(50);
  });

  it('skips the automatic reads while the last answer is fresh, but never a refresh', async () => {
    await mountShell();
    pathname.mockReturnValue('/settings/billing');
    await mountShell();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(getCreditBalance).toHaveBeenCalledTimes(1);

    // A payment landing inside the window still reads.
    await act(() => readers.billing!.refresh());
    expect(getCreditBalance).toHaveBeenCalledTimes(2);
  });

  it('reads again when the window comes back, once for focus and visibility together', async () => {
    await mountShell();
    pastTheWindow();
    let answer: (value: unknown) => void = () => {};
    getCreditBalance.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(getCreditBalance).toHaveBeenCalledTimes(2);
    answer(balanceFixture({ totalCredits: 3 }));
    await flush();
    expect(readers.billing?.balance?.totalCredits).toBe(3);
  });
});

describe('useRefreshCreditBalance', () => {
  it('does nothing without a provider', async () => {
    let refresh: () => Promise<void> = () => Promise.reject(new Error('unset'));
    function Alone() {
      const r = useRefreshCreditBalance();
      React.useEffect(() => {
        refresh = r;
      });
      return null;
    }
    await act(async () => {
      root.render(<Alone />);
      await Promise.resolve();
    });
    await act(() => refresh());
    expect(getCreditBalance).not.toHaveBeenCalled();
  });
});

describe('useCreditUsage', () => {
  it('reads the first page, then the next by cursor, appending', async () => {
    listCreditUsage.mockImplementation((cursor) =>
      Promise.resolve(
        cursor === 'c-2'
          ? { ...USAGE_PAGE, entries: [{ ...USAGE_PAGE.entries[0]!, id: 'e-9' }], nextCursor: null }
          : { ...USAGE_PAGE, nextCursor: 'c-2' },
      ),
    );
    await mount();
    expect(usage.entries).toHaveLength(2);
    expect(usage.hasMore).toBe(true);
    act(() => usage.loadMore());
    await flush();
    expect(listCreditUsage).toHaveBeenLastCalledWith('c-2');
    expect(usage.entries.map((e) => e.id)).toEqual(['e-1', 'e-2', 'e-9']);
    expect(usage.hasMore).toBe(false);
  });

  it('keeps the rows when "Show more" fails, and says so', async () => {
    listCreditUsage
      .mockResolvedValueOnce({ ...USAGE_PAGE, nextCursor: 'c-2' })
      .mockRejectedValueOnce(new Error('offline'));
    await mount();
    act(() => usage.loadMore());
    await flush();
    expect(usage.entries).toHaveLength(2);
    expect(usage.moreFailed).toBe(true);
    expect(usage.loadingMore).toBe(false);
  });

  it('drops a "Show more" answer that arrives after the list was read again', async () => {
    let late: (value: unknown) => void = () => {};
    listCreditUsage
      .mockResolvedValueOnce({ ...USAGE_PAGE, nextCursor: 'c-2' })
      .mockReturnValueOnce(new Promise((resolve) => (late = resolve)))
      .mockResolvedValueOnce(USAGE_PAGE);
    await mount();
    act(() => usage.loadMore());
    await act(() => usage.refetch());
    late({
      ...USAGE_PAGE,
      entries: [{ ...USAGE_PAGE.entries[0]!, id: 'stale' }],
      nextCursor: null,
    });
    await flush();
    expect(usage.entries.map((e) => e.id)).toEqual(['e-1', 'e-2']);
  });
});

describe('useCheckoutOrder', () => {
  const answer = (status: string) => ({
    id: 'order-1',
    status,
    planCode: 'topup_250',
    amountVnd: 125000,
    expiresAt: '2026-11-09T09:00:00.000Z',
    paidAt: null,
  });

  it('does nothing without an order', async () => {
    vi.useFakeTimers();
    await mount(null);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getCheckoutOrder).not.toHaveBeenCalled();
    expect(order).toBeNull();
  });

  it('keeps asking about an expired order, slower, and reports a late payment', async () => {
    vi.useFakeTimers();
    getCheckoutOrder
      .mockResolvedValueOnce(answer('expired'))
      .mockResolvedValueOnce(answer('expired'))
      .mockResolvedValue(answer('paid'));
    const onSettled = vi.fn();
    await mount('order-1', onSettled);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ORDER_POLL_MS);
    });
    expect(getCheckoutOrder).toHaveBeenCalledTimes(1);
    expect(onSettled).not.toHaveBeenCalled();
    // Not at the open-order cadence any more.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXPIRED_ORDER_POLL_MS - 1);
    });
    expect(getCheckoutOrder).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1 + EXPIRED_ORDER_POLL_MS);
    });
    expect(getCheckoutOrder).toHaveBeenCalledTimes(3);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(order?.status).toBe('paid');
  });

  it('stops asking about an expired order after a bounded number of asks', async () => {
    vi.useFakeTimers();
    getCheckoutOrder.mockResolvedValue(answer('expired'));
    const onSettled = vi.fn();
    await mount('order-1', onSettled);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        ORDER_POLL_MS + EXPIRED_ORDER_POLL_MS * (EXPIRED_ORDER_POLLS + 5),
      );
    });
    expect(getCheckoutOrder).toHaveBeenCalledTimes(1 + EXPIRED_ORDER_POLLS);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it.each(['paid', 'needs_review'])('stops at %s and reports it once', async (settled) => {
    vi.useFakeTimers();
    getCheckoutOrder.mockResolvedValueOnce(answer('pending')).mockResolvedValue(answer(settled));
    const onSettled = vi.fn();
    await mount('order-1', onSettled);
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    }
    expect(getCheckoutOrder).toHaveBeenCalledTimes(2);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(order?.status).toBe(settled);
  });

  it('stops when the order id goes away', async () => {
    vi.useFakeTimers();
    getCheckoutOrder.mockResolvedValue(answer('pending'));
    await mount('order-1');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(getCheckoutOrder).toHaveBeenCalledTimes(1);
    await mount(null);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(getCheckoutOrder).toHaveBeenCalledTimes(1);
    expect(order).toBeNull();
  });
});
