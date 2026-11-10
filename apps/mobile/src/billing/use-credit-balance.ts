/**
 * The signed-in account's credits for the settings screen: balance and plan
 * from `GET /billing/me`, the newest usage rows from `GET /billing/usage`.
 *
 * The two reads are separate queries on purpose. A usage page that fails to
 * load must not hide a balance that loaded, and each says its own "try again".
 * Buying is never offered here; the screen links out to the web.
 *
 * The fetchers are passed in rather than imported, so this module (and the
 * pure helpers its spec checks) loads under node without the app's auth chain.
 */

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CreditBalance, CreditUsageEntry, CreditUsageListRead } from '@chatofy/types';

/** How many usage rows settings lists. The web's account page pages; the phone does not. */
export const SETTINGS_USAGE_ROWS = 10;

export const creditQueryKeys = {
  balance: ['billing', 'me'] as const,
  usage: ['billing', 'usage'] as const,
};

export interface CreditFetchers {
  balance: () => Promise<CreditBalance>;
  usage: () => Promise<CreditUsageListRead>;
}

/** What settings offers in place of a checkout. */
export type BuyAction = 'buy-on-web' | 'checkout-closed';

/**
 * The newest `limit` readable rows. The API answers newest first, so this is a
 * prefix; rows a shipped app cannot read were already dropped by the parse.
 */
export function recentUsage(
  read: CreditUsageListRead | undefined,
  limit: number = SETTINGS_USAGE_ROWS,
): CreditUsageEntry[] {
  return read ? read.entries.slice(0, Math.max(0, limit)) : [];
}

/**
 * An account let in to checkout gets a link to the web's account page; everyone
 * else reads why buying is closed. The API decides, never the app.
 */
export function buyActionFor(balance: Pick<CreditBalance, 'checkoutAllowed'>): BuyAction {
  return balance.checkoutAllowed ? 'buy-on-web' : 'checkout-closed';
}

export interface UseCreditBalance {
  balance: CreditBalance | undefined;
  balanceLoading: boolean;
  balanceFailed: boolean;
  usage: CreditUsageEntry[];
  usageLoading: boolean;
  usageFailed: boolean;
  /** Reads both again, e.g. when settings comes back into view after a conversation. */
  refetch: () => void;
}

/** Both reads, enabled only while somebody is signed in. */
export function useCreditBalance(fetchers: CreditFetchers, enabled: boolean): UseCreditBalance {
  const balance = useQuery({
    queryKey: creditQueryKeys.balance,
    queryFn: fetchers.balance,
    enabled,
  });
  const usage = useQuery({
    queryKey: creditQueryKeys.usage,
    queryFn: fetchers.usage,
    enabled,
  });
  const refetchBalance = balance.refetch;
  const refetchUsage = usage.refetch;

  const refetch = useCallback(() => {
    if (!enabled) return;
    // A failed refetch lands in the query's error state, which the screen renders.
    void refetchBalance();
    void refetchUsage();
  }, [enabled, refetchBalance, refetchUsage]);

  return {
    balance: balance.data,
    balanceLoading: enabled && balance.isPending,
    balanceFailed: balance.isError,
    usage: recentUsage(usage.data),
    usageLoading: enabled && usage.isPending,
    usageFailed: usage.isError,
    refetch,
  };
}
