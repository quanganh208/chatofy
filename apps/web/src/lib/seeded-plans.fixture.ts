import type { Plan } from '@chatofy/types';

/**
 * The rows the credits migration seeds (`20261109114047_add_credits_ledger`), as
 * `GET /billing/plans` returns them. A spec fixture: the page itself never knows a price.
 */
export const SEEDED_PLANS: Plan[] = [
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
  {
    code: 'topup_550',
    kind: 'topup',
    credits: 550,
    priceUsdCents: 1000,
    priceVnd: 250000,
    periodDays: null,
    rails: ['polar', 'sepay'],
  },
  {
    code: 'topup_1500',
    kind: 'topup',
    credits: 1500,
    priceUsdCents: 2500,
    priceVnd: 625000,
    periodDays: null,
    rails: [],
  },
];
