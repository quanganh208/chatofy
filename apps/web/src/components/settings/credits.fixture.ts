import type { CreditBalance, CreditUsageListRead, Plan } from '@chatofy/types';

/**
 * Test fixtures for the Settings › Billing credits region, at the shapes the API
 * answers. Shared by the section specs and the accent-budget rows so every one
 * counts the same screen. The plans mirror the rows the credits migration seeds.
 */

export const PLANS: Plan[] = [
  {
    code: 'free',
    kind: 'free',
    credits: 120,
    priceUsdCents: null,
    priceVnd: null,
    periodDays: null,
    rails: [],
  },
  {
    code: 'pro_monthly',
    kind: 'subscription',
    credits: 600,
    priceUsdCents: 999,
    priceVnd: null,
    periodDays: 30,
    rails: ['polar'],
  },
  {
    code: 'pro_pass_30d',
    kind: 'pass',
    credits: 600,
    priceUsdCents: null,
    priceVnd: 249000,
    periodDays: 30,
    rails: ['sepay'],
  },
  {
    code: 'topup_250',
    kind: 'topup',
    credits: 250,
    priceUsdCents: 500,
    priceVnd: 125000,
    periodDays: null,
    rails: ['polar', 'sepay'],
  },
];

export function balanceFixture(over: Partial<CreditBalance> = {}): CreditBalance {
  return {
    totalCredits: 87.5,
    planCredits: 37.5,
    topupCredits: 50,
    planResetsAt: '2026-12-01T00:00:00.000Z',
    plan: 'free',
    proSource: null,
    checkoutAllowed: false,
    rails: { polar: 'sandbox', sepay: 'sandbox' },
    ...over,
  };
}

export const USAGE_PAGE: CreditUsageListRead = {
  entries: [
    {
      id: 'e-1',
      at: '2026-11-09T08:00:00.000Z',
      kind: 'translate',
      credits: -12.5,
      conversationId: 'conv-1',
      label: 'Live translation',
    },
    {
      id: 'e-2',
      at: '2026-11-01T00:00:00.000Z',
      kind: 'grant',
      credits: 120,
      conversationId: null,
      label: 'Free monthly credits',
    },
  ],
  nextCursor: null,
  dropped: 0,
};

export const SEPAY_ORDER = {
  rail: 'sepay' as const,
  orderId: 'order-1',
  orderCode: 'CHFABCD2345',
  amountVnd: 125000,
  qrUrl: 'https://vietqr.app/img?bank=MBBank&acc=1&amount=125000&des=CHFABCD2345',
  expiresAt: '2026-11-09T09:00:00.000Z',
};
