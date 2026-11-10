// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { balanceFixture, USAGE_PAGE } from '@/components/account/credits.fixture';
import {
  useCheckoutOrder,
  useCreditBalance,
  useCreditUsage,
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

    await act(() => balance.refetch());
    expect(balance.state).toBe('ready');
    getCreditBalance.mockRejectedValueOnce(new Error('503'));
    await act(() => balance.refetch());
    expect(balance.state).toBe('failed');
    expect(balance.balance?.totalCredits).toBe(87.5);
  });

  it('lets the newest read win over a slower earlier one', async () => {
    let slow: (value: unknown) => void = () => {};
    getCreditBalance.mockReturnValueOnce(new Promise((resolve) => (slow = resolve)));
    await mount();
    getCreditBalance.mockResolvedValueOnce(balanceFixture({ totalCredits: 337.5 }));
    await act(() => balance.refetch());
    slow(balanceFixture({ totalCredits: 1 }));
    await flush();
    expect(balance.balance?.totalCredits).toBe(337.5);
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

  it.each(['paid', 'expired', 'needs_review'])(
    'stops at %s and reports it once',
    async (settled) => {
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
    },
  );

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
