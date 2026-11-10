import type { Prisma } from '@prisma/client';

// The one interface every consumer of credits goes through: the translation
// meter, minutes, the payment rails. It is reached by the `CREDIT_LEDGER`
// injection token so the fast e2e suites — which boot the whole app on a stubbed
// Prisma — can swap in the in-memory ledger in `test/utils` without touching a
// database. Both implementations share `credit-spend.ts`, so they allocate and
// give back in the same order.
//
// Every amount here is integer credit-SECONDS (60 per credit).

export const CREDIT_LEDGER = Symbol('CREDIT_LEDGER');

/**
 * The ledger could not be reached in time: the user's lock was held past
 * `lock_timeout`, no pool connection came within `maxWait`, the transaction ran
 * past its timeout, or the database is down. Nothing was written. Callers
 * decide what an outage means for them — a new session fails closed, a running
 * one may carry on for one more lease.
 */
export class LedgerUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('The credit ledger is unavailable right now', options);
    this.name = 'LedgerUnavailableError';
  }
}

export type GrantSource =
  'free' | 'subscription' | 'pass' | 'topup' | 'promo' | 'refund';

export interface GrantInput {
  userId: string;
  source: GrantSource;
  planCode?: string | null;
  /** Credit-seconds; must be positive. */
  amount: number;
  /** Start of the paid period this grant covers. */
  startsAt?: Date | null;
  /** Null never expires. */
  expiresAt?: Date | null;
  /** Minor units paid; 0 (the default) for anything free. */
  costBasis?: number;
  currency?: string | null;
  /** Idempotency key of what caused the grant; a second grant with it is a no-op. */
  externalRef: string;
  /** Written on the `grant` entry (an audit note, never shown to the user as-is). */
  reason?: string | null;
}

export type GrantResult =
  | { state: 'granted'; grantId: string }
  /** A grant with this `externalRef` already exists; nothing was written. */
  | { state: 'duplicate'; grantId: string };

export interface LedgerBalance {
  /** Spendable now, outside any lease. */
  available: number;
  /** Held by the user's open leases and not yet consumed. */
  held: number;
  /** Free/Pro credits, held ones included, so an idle socket does not look like spending. */
  planSeconds: number;
  /** Top-up, promo and refund credits (never expire), held ones included. */
  topupSeconds: number;
  /** Soonest expiry among the live plan grants; null when there is none. */
  planResetsAt: Date | null;
  plan: 'free' | 'pro';
  /** Which Pro grant is live: a subscription (Polar) or a pass (SePay). */
  proSource: 'subscription' | 'pass' | null;
}

/** A lease mutation that found the lease no longer open: nothing was written. */
export interface NotOpen {
  state: 'not_open';
}

export interface LeaseState {
  state: 'ok';
  leaseId: string;
  /** Credit-seconds the lease holds in total, and how many it has consumed. */
  held: number;
  consumed: number;
  /** What this call added to `held` (may be 0: the balance is empty). */
  granted: number;
  /** Spendable balance left outside the lease after this call. */
  available: number;
}

export interface SettleInput {
  leaseId: string;
  /** Credit-seconds consumed (audio seconds × multiplier, whole). */
  seconds: number;
  sessionId: string;
  conversationId?: string | null;
  /** Defaults to `settle:<sessionId>`: one settle per turn. */
  idempotencyKey?: string;
}

export interface SettleState {
  state: 'ok';
  /** Charged to the user: from the lease's holding plus any overshoot the grants covered. */
  covered: number;
  /** Consumed beyond everything the user had; recorded, never charged. */
  uncovered: number;
  /** The idempotency key was already settled; nothing new was written. */
  duplicate: boolean;
  available: number;
}

export interface CloseState {
  state: 'ok';
  /** Credit-seconds given back to the grants. */
  released: number;
}

export interface DebitInput {
  userId: string;
  amount: number;
  idempotencyKey: string;
  reason?: string | null;
  sessionId?: string | null;
  conversationId?: string | null;
}

export type DebitResult =
  | { state: 'ok'; duplicate: boolean; available: number }
  /** All or nothing: a debit the balance cannot cover writes nothing. */
  | { state: 'insufficient'; available: number };

export interface RefundInput {
  userId: string;
  /** The `idempotencyKey` the debit was written with. */
  debitKey: string;
  idempotencyKey: string;
  reason?: string | null;
}

export interface RefundResult {
  state: 'ok';
  /** Credit-seconds put back; 0 when the debit was not found or already refunded. */
  refunded: number;
  duplicate: boolean;
}

/** Ledger and lease operations. Any of them may throw `LedgerUnavailableError`. */
export interface CreditLedgerPort {
  balance(userId: string): Promise<LedgerBalance>;
  /**
   * Writes a grant and its `grant` entry. With `tx`, runs inside the caller's
   * transaction (a webhook composes it with its dedup insert); a duplicate
   * `externalRef` is reported, never thrown, so it cannot abort that transaction.
   */
  grant(input: GrantInput, tx?: Prisma.TransactionClient): Promise<GrantResult>;
  debit(input: DebitInput): Promise<DebitResult>;
  refund(input: RefundInput): Promise<RefundResult>;
  /** Opens a lease holding up to `want`; holds less (even 0) when the balance is short. */
  openLease(userId: string, want: number): Promise<LeaseState>;
  extendLease(leaseId: string, want: number): Promise<LeaseState | NotOpen>;
  settleLease(input: SettleInput): Promise<SettleState | NotOpen>;
  closeLease(leaseId: string): Promise<CloseState | NotOpen>;
}
