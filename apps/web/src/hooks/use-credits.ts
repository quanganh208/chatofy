'use client';

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type {
  CheckoutOrder,
  CheckoutOrderStatus,
  CreditBalance,
  CreditUsageEntry,
} from '@chatofy/types';
import { getCheckoutOrder, getCreditBalance, listCreditUsage } from '@/clients/api-client';
import { readSettingsDialog } from '@/components/settings/settings-dialog-url';

/**
 * The caller's credits, as the sidebar meter, Settings › Billing and the `/translate`
 * readiness banner read them.
 *
 * Three small hooks rather than one: the banner needs only the balance, and
 * fetching a page of usage it never shows on every `/translate` mount would be a
 * query per visit for nothing.
 */

export type LoadState = 'loading' | 'ready' | 'failed';

export interface UseCreditBalance {
  balance: CreditBalance | null;
  state: LoadState;
  /**
   * Read the balance again — after a payment lands, on return from Polar, at the end
   * of a conversation. Under {@link CreditBalanceProvider} every reader updates from
   * the one read.
   */
  refresh: () => Promise<void>;
}

/**
 * One `GET /billing/me` state: on mount when `enabled`, and on demand.
 *
 * A read that fails keeps the last balance on screen and only flips `state`:
 * a number that was right a minute ago is more useful than a blank, and the
 * failure line beside it says it may be stale.
 */
function useBalanceRead(enabled: boolean): UseCreditBalance & { recentlyRead: () => boolean } {
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const alive = useRef(true);
  // Which read is the current answer: a slow first read must not overwrite the
  // refresh a payment just triggered.
  const seq = useRef(0);
  const pending = useRef(0);
  // When the last read settled, either way; `0` until one has.
  const settledAt = useRef(0);

  // State is only ever set in the read's own callbacks, never synchronously.
  const refresh = useCallback((): Promise<void> => {
    const id = (seq.current += 1);
    const current = () => alive.current && id === seq.current;
    pending.current += 1;
    return getCreditBalance()
      .then(
        (next) => {
          if (!current()) return;
          setBalance(next);
          setState('ready');
        },
        () => {
          if (current()) setState('failed');
        },
      )
      .finally(() => {
        pending.current -= 1;
        settledAt.current = Date.now();
      });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh, enabled]);

  // In the air, or answered within the window: an automatic read would only repeat it.
  const recentlyRead = useCallback(
    () => pending.current > 0 || Date.now() - settledAt.current < AUTO_REFRESH_WINDOW_MS,
    [],
  );
  return { balance, state, refresh, recentlyRead };
}

/**
 * How long a balance read stays fresh for the reads nobody asked for — a route change
 * or a return to the window. `GET /billing/me` allows 60 reads a minute per IP, and a
 * reader clicking through the sidebar would otherwise spend one per click; a 429 would
 * then turn the shared meter to `failed`. An explicit `refresh()` (a payment landed, a
 * conversation ended) always reads.
 */
export const AUTO_REFRESH_WINDOW_MS = 15_000;

const CreditBalanceContext = createContext<UseCreditBalance | null>(null);

/**
 * The signed-in shell's one balance, mounted once in `AppChrome`.
 *
 * The chrome never remounts on client navigation, so a balance read once by the sidebar
 * would say the pre-conversation number for the rest of the session, and disagree with
 * Billing beside it the moment a payment landed. Here every reader shares one state,
 * and it is read again:
 *
 * - on a route change (the mount read covers the first route), and when the Settings
 *   dialog opens or changes tab — it is a place you go to without leaving the route,
 *   and Billing is the one that shows this number in full;
 * - when the window comes back into view — focus and `visibilitychange` both fire on a
 *   tab switch;
 * - whenever a reader calls `refresh()`.
 *
 * The first two skip a read while one is in the air or one settled within
 * {@link AUTO_REFRESH_WINDOW_MS}; `refresh()` never skips.
 */
export function CreditBalanceProvider({ children }: { children: ReactNode }) {
  const { balance, state, refresh, recentlyRead } = useBalanceRead(true);
  const settings = readSettingsDialog(useSearchParams());
  const place = `${usePathname()}#${settings === undefined ? '' : (settings ?? 'menu')}`;
  const lastPlace = useRef(place);

  useEffect(() => {
    if (lastPlace.current === place) return;
    lastPlace.current = place;
    if (!recentlyRead()) void refresh();
  }, [place, refresh, recentlyRead]);

  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== 'visible' || recentlyRead()) return;
      void refresh();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [refresh, recentlyRead]);

  const value = useMemo(() => ({ balance, state, refresh }), [balance, state, refresh]);
  return createElement(CreditBalanceContext.Provider, { value }, children);
}

/**
 * The balance: the shell's shared one under {@link CreditBalanceProvider}, or a read of
 * this component's own on mount without one (a component mounted alone, as in a spec).
 */
export function useCreditBalance(): UseCreditBalance {
  const shared = useContext(CreditBalanceContext);
  const own = useBalanceRead(shared === null);
  if (shared) return shared;
  return { balance: own.balance, state: own.state, refresh: own.refresh };
}

const NO_REFRESH = (): Promise<void> => Promise.resolve();

/**
 * Only the shared balance's `refresh`, for a screen that changes the balance without
 * showing it (a translate conversation spends credits). A no-op without a provider:
 * there is no shared reader to update, and a read here would be one nobody shows.
 */
export function useRefreshCreditBalance(): () => Promise<void> {
  return useContext(CreditBalanceContext)?.refresh ?? NO_REFRESH;
}

export interface UseCreditUsage {
  entries: CreditUsageEntry[];
  state: LoadState;
  /** True when the server has an older page; "Show more" is offered only then. */
  hasMore: boolean;
  loadingMore: boolean;
  /** A "Show more" that failed; the rows already shown stay. */
  moreFailed: boolean;
  loadMore: () => void;
  /** Read the first page again (a payment just added a grant row). */
  refetch: () => Promise<void>;
}

/**
 * `GET /billing/usage`, first page once `enabled`, older pages by cursor.
 *
 * `enabled` lets Settings › Billing wait for its balance read: the first balance read
 * of a month is what writes that month's Free grant, so a usage page read in
 * parallel with it can miss the row that explains the balance beside it.
 */
export function useCreditUsage(enabled = true): UseCreditUsage {
  const [entries, setEntries] = useState<CreditUsageEntry[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const alive = useRef(true);
  // Bumped by a first-page read, so a "Show more" in flight from the previous
  // list cannot append its rows to the fresh one.
  const generation = useRef(0);

  const refetch = useCallback((): Promise<void> => {
    const id = (generation.current += 1);
    const current = () => alive.current && id === generation.current;
    return listCreditUsage().then(
      (page) => {
        if (!current()) return;
        setEntries(page.entries);
        setCursor(page.nextCursor);
        setMoreFailed(false);
        setState('ready');
      },
      () => {
        if (current()) setState('failed');
      },
    );
  }, []);

  useEffect(() => {
    alive.current = true;
    if (enabled) void refetch();
    return () => {
      alive.current = false;
    };
  }, [refetch, enabled]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return;
    const id = generation.current;
    setLoadingMore(true);
    setMoreFailed(false);
    listCreditUsage(cursor)
      .then((page) => {
        if (!alive.current || id !== generation.current) return;
        setEntries((prev) => [...prev, ...page.entries]);
        setCursor(page.nextCursor);
      })
      .catch(() => {
        if (alive.current && id === generation.current) setMoreFailed(true);
      })
      .finally(() => {
        if (alive.current) setLoadingMore(false);
      });
  }, [cursor, loadingMore]);

  return {
    entries,
    state,
    hasMore: cursor !== null,
    loadingMore,
    moreFailed,
    loadMore,
    refetch,
  };
}

/** How often an open VietQR order is asked about. */
export const ORDER_POLL_MS = 3000;
/**
 * How often an EXPIRED order is still asked about, and for how many asks. The
 * server grants a matching transfer however late it lands, so a transfer sent
 * just before the QR expired can still settle the order; the slower cadence
 * keeps watching for it for ten minutes without polling forever.
 */
export const EXPIRED_ORDER_POLL_MS = 15_000;
export const EXPIRED_ORDER_POLLS = 40;

/**
 * Statuses after which nothing more will happen to an order on its own:
 * paid, or held for the owner to review. Polling stops at any of them.
 * `expired` is not one: a late transfer still moves it to `paid`.
 */
const SETTLED: ReadonlySet<CheckoutOrderStatus> = new Set([
  'paid',
  'needs_review',
  'resolved_granted',
  'resolved_dismissed',
]);

/**
 * Poll one SePay order every {@link ORDER_POLL_MS} until it settles, or until
 * the caller unmounts or passes `null`. Once it reads `expired`, polling slows
 * to {@link EXPIRED_ORDER_POLL_MS} and stops after {@link EXPIRED_ORDER_POLLS}
 * asks, unless a late transfer settles it first.
 *
 * A timeout chain rather than an interval, so a slow answer is never overlapped
 * by the next request. A failed poll is not an answer — the transfer may still
 * land — so it simply waits for the next tick. `onSettled` fires once per order.
 */
export function useCheckoutOrder(
  orderId: string | null,
  onSettled?: (order: CheckoutOrder) => void,
): CheckoutOrder | null {
  // Keyed by the order it answers, so a new id reads as null without a reset.
  const [answer, setAnswer] = useState<{ orderId: string; order: CheckoutOrder } | null>(null);
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  });

  useEffect(() => {
    if (!orderId) return;
    let stopped = false;
    let expired = false;
    let expiredPolls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      if (expired) expiredPolls += 1;
      getCheckoutOrder(orderId)
        .then((next) => {
          if (stopped) return;
          setAnswer({ orderId, order: next });
          if (SETTLED.has(next.status)) {
            stopped = true;
            settledRef.current?.(next);
          } else if (next.status === 'expired') {
            expired = true;
          }
        })
        .catch(() => {
          // Transient: the next tick asks again.
        })
        .finally(() => {
          if (expired && expiredPolls >= EXPIRED_ORDER_POLLS) stopped = true;
          if (!stopped) {
            timer = setTimeout(tick, expired ? EXPIRED_ORDER_POLL_MS : ORDER_POLL_MS);
          }
        });
    };
    timer = setTimeout(tick, ORDER_POLL_MS);

    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [orderId]);

  return answer !== null && answer.orderId === orderId ? answer.order : null;
}
