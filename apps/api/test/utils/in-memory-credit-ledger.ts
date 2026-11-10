import { randomUUID } from 'node:crypto';
import { CREDIT_SECONDS_PER_CREDIT } from '@chatofy/types';
import {
  billingMonthKey,
  billingMonthStart,
  nextBillingMonthStart,
} from '../../src/modules/credits/billing-period';
import { summarizeBalance } from '../../src/modules/credits/credit-balance';
import {
  LedgerUnavailableError,
  type CloseState,
  type CreditLedgerPort,
  type DebitInput,
  type DebitResult,
  type GrantInput,
  type GrantResult,
  type LeaseState,
  type LedgerBalance,
  type NotOpen,
  type RefundInput,
  type RefundResult,
  type SettleInput,
  type SettleState,
} from '../../src/modules/credits/credit-ledger.port';
import {
  LEASE_AUDIO_SECONDS,
  LEASE_GRACE_MS,
} from '../../src/modules/credits/credit-pricing';
import {
  allocate,
  assertCreditSeconds,
  distributeRelease,
  type LeaseReserve,
} from '../../src/modules/credits/credit-spend';

interface Grant {
  id: string;
  userId: string;
  source: string;
  amount: number;
  remaining: number;
  expiresAt: Date | null;
  costBasis: number;
  createdAt: Date;
  status: 'active' | 'expired' | 'voided';
  externalRef: string;
}

interface Lease {
  id: string;
  userId: string;
  held: number;
  consumed: number;
  expiresAt: Date;
  status: 'open' | 'closed' | 'reaped';
  reserves: LeaseReserve[];
}

/** Every entry the double writes, for a suite that wants to assert on it. */
export interface InMemoryEntry {
  userId: string;
  kind: string;
  amount: number;
  idempotencyKey: string;
  grantId?: string;
  leaseId?: string;
  sessionId?: string | null;
  conversationId?: string | null;
  reason?: string | null;
}

const NOT_OPEN: NotOpen = { state: 'not_open' };

/**
 * A `CreditLedgerPort` held in Maps, for the suites that boot the whole app on
 * a stubbed Prisma: `.overrideProvider(CREDIT_LEDGER).useValue(new InMemoryCreditLedger())`.
 *
 * It is a test double, not a backend, and it keeps the Prisma ledger's rules
 * rather than approximating them: the same `allocate` and `distributeRelease`
 * (so spend and release order match), the same Free grant per local month with
 * no Free during a live Pro grant, and the same `not_open` answer from every
 * lease mutation once a lease is closed or reaped. JavaScript is single
 * threaded and nothing here awaits mid-operation, so each call is as atomic as
 * the Prisma one is under its advisory lock.
 */
export class InMemoryCreditLedger implements CreditLedgerPort {
  readonly entries: InMemoryEntry[] = [];
  private readonly grants = new Map<string, Grant>();
  private readonly leases = new Map<string, Lease>();
  private readonly keys = new Set<string>();
  private unavailable = false;

  constructor(
    private readonly options: {
      /** Monthly Free allowance in whole credits; 120 like the seeded plan. */
      freeCredits?: number;
      now?: () => Date;
    } = {},
  ) {}

  /** Gives `userId` a never-expiring top-up of `credits` whole credits. */
  seed(userId: string, credits: number): string {
    const result = this.writeGrant({
      userId,
      source: 'topup',
      amount: credits * CREDIT_SECONDS_PER_CREDIT,
      externalRef: `seed:${randomUUID()}`,
    });
    return result.grantId;
  }

  /** While set, every call throws `LedgerUnavailableError`, as an outage would. */
  setUnavailable(unavailable: boolean): void {
    this.unavailable = unavailable;
  }

  /** Expires a lease's claim at once, then reaps it — what the reaper does to a dead socket. */
  reap(leaseId: string): boolean {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.status !== 'open') return false;
    lease.status = 'reaped';
    this.release(lease);
    return true;
  }

  async balance(userId: string): Promise<LedgerBalance> {
    this.check();
    const now = this.now();
    this.prepare(userId, now);
    const leases = [...this.leases.values()].filter(
      (l) => l.userId === userId && l.status === 'open',
    );
    return summarizeBalance(this.live(userId, now), leases, now);
  }

  async grant(input: GrantInput): Promise<GrantResult> {
    this.check();
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      throw new RangeError(
        `grant amount must be a positive integer, got ${input.amount}`,
      );
    }
    return this.writeGrant(input);
  }

  async debit(input: DebitInput): Promise<DebitResult> {
    this.check();
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      throw new RangeError(
        `debit amount must be a positive integer, got ${input.amount}`,
      );
    }
    const now = this.now();
    if (this.keys.has(input.idempotencyKey)) {
      return {
        state: 'ok',
        duplicate: true,
        available: this.available(input.userId, now),
      };
    }
    this.prepare(input.userId, now);
    const available = this.available(input.userId, now);
    if (available < input.amount) return { state: 'insufficient', available };
    this.take(input.userId, input.amount, 'debit', input.idempotencyKey, now, {
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      reason: input.reason,
    });
    return {
      state: 'ok',
      duplicate: false,
      available: available - input.amount,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    this.check();
    if (this.keys.has(input.idempotencyKey))
      return { state: 'ok', refunded: 0, duplicate: true };
    const debits = this.entries.filter(
      (e) =>
        e.userId === input.userId &&
        e.kind === 'debit' &&
        (e.idempotencyKey === input.debitKey ||
          e.idempotencyKey.startsWith(`${input.debitKey}#`)),
    );
    let refunded = 0;
    debits.forEach((debit, index) => {
      const key =
        index === 0
          ? input.idempotencyKey
          : `${input.idempotencyKey}#${index + 1}`;
      refunded += this.giveBack(
        debit.grantId!,
        -debit.amount,
        'refund',
        key,
        input.userId,
      );
    });
    return { state: 'ok', refunded, duplicate: false };
  }

  async openLease(userId: string, want: number): Promise<LeaseState> {
    this.check();
    assertCreditSeconds(want, 'want');
    const now = this.now();
    this.prepare(userId, now);
    const lease: Lease = {
      id: randomUUID(),
      userId,
      held: 0,
      consumed: 0,
      expiresAt: this.expiry(now),
      status: 'open',
      reserves: [],
    };
    this.leases.set(lease.id, lease);
    const granted = this.reserve(
      lease,
      want,
      `reserve:${lease.id}:${randomUUID()}`,
      now,
    );
    lease.held = granted;
    return {
      state: 'ok',
      leaseId: lease.id,
      held: granted,
      consumed: 0,
      granted,
      available: this.available(userId, now),
    };
  }

  async extendLease(
    leaseId: string,
    want: number,
  ): Promise<LeaseState | NotOpen> {
    this.check();
    assertCreditSeconds(want, 'want');
    const lease = this.openLeaseOf(leaseId);
    if (!lease) return NOT_OPEN;
    const now = this.now();
    lease.expiresAt = this.expiry(now);
    this.prepare(lease.userId, now);
    const granted = this.reserve(
      lease,
      want,
      `reserve:${leaseId}:${randomUUID()}`,
      now,
    );
    lease.held += granted;
    return {
      state: 'ok',
      leaseId,
      held: lease.held,
      consumed: lease.consumed,
      granted,
      available: this.available(lease.userId, now),
    };
  }

  async settleLease(input: SettleInput): Promise<SettleState | NotOpen> {
    this.check();
    assertCreditSeconds(input.seconds, 'seconds');
    const key = input.idempotencyKey ?? `settle:${input.sessionId}`;
    const now = this.now();
    const prior = this.entries.find((e) => e.idempotencyKey === key);
    if (prior) {
      const userId = prior.userId;
      return {
        state: 'ok',
        covered: -prior.amount,
        uncovered: 0,
        duplicate: true,
        available: this.available(userId, now),
      };
    }
    const lease = this.openLeaseOf(input.leaseId);
    if (!lease) return NOT_OPEN;
    lease.expiresAt = this.expiry(now);
    const fromHold = Math.min(
      input.seconds,
      Math.max(0, lease.held - lease.consumed),
    );
    const over = input.seconds - fromHold;
    let extra = 0;
    if (over > 0) {
      this.prepare(lease.userId, now);
      extra = this.reserve(lease, over, `${key}#reserve`, now);
    }
    const uncovered = over - extra;
    lease.held += extra;
    lease.consumed += fromHold + extra;
    const base = {
      userId: lease.userId,
      leaseId: lease.id,
      kind: 'settle',
      sessionId: input.sessionId,
      conversationId: input.conversationId ?? null,
    };
    this.write({ ...base, amount: -(fromHold + extra), idempotencyKey: key });
    if (uncovered > 0) {
      this.write({
        ...base,
        amount: -uncovered,
        idempotencyKey: `${key}#uncovered`,
        reason: 'overshoot_uncovered',
      });
    }
    return {
      state: 'ok',
      covered: fromHold + extra,
      uncovered,
      duplicate: false,
      available: this.available(lease.userId, now),
    };
  }

  async closeLease(leaseId: string): Promise<CloseState | NotOpen> {
    this.check();
    const lease = this.openLeaseOf(leaseId);
    if (!lease) return NOT_OPEN;
    lease.status = 'closed';
    return { state: 'ok', released: this.release(lease) };
  }

  private check(): void {
    if (this.unavailable) throw new LedgerUnavailableError();
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private expiry(now: Date): Date {
    return new Date(
      now.getTime() + LEASE_AUDIO_SECONDS * 1000 + LEASE_GRACE_MS,
    );
  }

  private openLeaseOf(leaseId: string): Lease | null {
    const lease = this.leases.get(leaseId);
    return lease && lease.status === 'open' ? lease : null;
  }

  private write(entry: InMemoryEntry): void {
    if (this.keys.has(entry.idempotencyKey)) {
      throw new Error(`duplicate idempotency key ${entry.idempotencyKey}`);
    }
    this.keys.add(entry.idempotencyKey);
    this.entries.push(entry);
  }

  private writeGrant(input: GrantInput): GrantResult {
    const existing = [...this.grants.values()].find(
      (g) => g.externalRef === input.externalRef,
    );
    if (existing) return { state: 'duplicate', grantId: existing.id };
    const grant: Grant = {
      id: randomUUID(),
      userId: input.userId,
      source: input.source,
      amount: input.amount,
      remaining: input.amount,
      expiresAt: input.expiresAt ?? null,
      costBasis: input.costBasis ?? 0,
      createdAt: this.now(),
      status: 'active',
      externalRef: input.externalRef,
    };
    this.grants.set(grant.id, grant);
    this.write({
      userId: input.userId,
      grantId: grant.id,
      kind: 'grant',
      amount: input.amount,
      idempotencyKey: `grant:${input.externalRef}`,
      reason: input.reason ?? null,
    });
    return { state: 'granted', grantId: grant.id };
  }

  /** Expiry, then the Free grant, exactly as the Prisma ledger starts each call. */
  private prepare(userId: string, now: Date): void {
    for (const grant of this.grants.values()) {
      if (
        grant.userId === userId &&
        grant.status === 'active' &&
        grant.expiresAt &&
        grant.expiresAt <= now
      ) {
        this.expire(grant);
      }
    }
    const freeAmount =
      (this.options.freeCredits ?? 120) * CREDIT_SECONDS_PER_CREDIT;
    if (freeAmount <= 0) return;
    const proLive = [...this.grants.values()].some(
      (g) =>
        g.userId === userId &&
        g.status === 'active' &&
        (g.source === 'subscription' || g.source === 'pass') &&
        g.expiresAt !== null &&
        g.expiresAt > now,
    );
    if (proLive) return;
    const externalRef = `free:${userId}:${billingMonthKey(now)}`;
    if ([...this.grants.values()].some((g) => g.externalRef === externalRef))
      return;
    this.writeGrant({
      userId,
      source: 'free',
      planCode: 'free',
      amount: freeAmount,
      startsAt: billingMonthStart(now),
      expiresAt: nextBillingMonthStart(now),
      externalRef,
    });
  }

  private expire(grant: Grant): void {
    this.write({
      userId: grant.userId,
      grantId: grant.id,
      kind: 'expire',
      amount: -grant.remaining,
      idempotencyKey: `expire:${grant.id}`,
    });
    grant.remaining = 0;
    grant.status = 'expired';
  }

  private live(userId: string, now: Date): Grant[] {
    return [...this.grants.values()].filter(
      (g) =>
        g.userId === userId &&
        g.status === 'active' &&
        (g.expiresAt === null || g.expiresAt > now),
    );
  }

  private available(userId: string, now: Date): number {
    return this.live(userId, now).reduce((sum, g) => sum + g.remaining, 0);
  }

  private take(
    userId: string,
    want: number,
    kind: 'reserve' | 'debit',
    keyBase: string,
    now: Date,
    extra: {
      leaseId?: string;
      sessionId?: string | null;
      conversationId?: string | null;
      reason?: string | null;
    } = {},
  ): { grantId: string; take: number; entryKey: string }[] {
    if (want === 0) return [];
    return allocate(want, this.live(userId, now)).map(
      ({ grantId, take }, index) => {
        this.grants.get(grantId)!.remaining -= take;
        const entryKey = index === 0 ? keyBase : `${keyBase}#${index + 1}`;
        this.write({
          userId,
          grantId,
          kind,
          amount: -take,
          idempotencyKey: entryKey,
          ...extra,
        });
        return { grantId, take, entryKey };
      },
    );
  }

  private reserve(
    lease: Lease,
    want: number,
    keyBase: string,
    now: Date,
  ): number {
    let taken = 0;
    for (const part of this.take(lease.userId, want, 'reserve', keyBase, now, {
      leaseId: lease.id,
    })) {
      lease.reserves.push({
        entryId: part.entryKey,
        grantId: part.grantId,
        take: part.take,
        createdAt: now,
      });
      taken += part.take;
    }
    return taken;
  }

  private release(lease: Lease): number {
    let released = 0;
    for (const part of distributeRelease(
      Math.max(0, lease.held - lease.consumed),
      lease.reserves,
    )) {
      released += this.giveBack(
        part.grantId,
        part.back,
        'release',
        `release:${part.entryId}`,
        lease.userId,
        lease.id,
      );
    }
    return released;
  }

  /** A release or refund, written off again at once for a grant that expired or was voided meanwhile. */
  private giveBack(
    grantId: string,
    back: number,
    kind: 'release' | 'refund',
    key: string,
    userId: string,
    leaseId?: string,
  ): number {
    if (back <= 0) return 0;
    const grant = this.grants.get(grantId)!;
    grant.remaining += back;
    this.write({
      userId,
      grantId,
      leaseId,
      kind,
      amount: back,
      idempotencyKey: key,
    });
    if (grant.status === 'active') {
      if (grant.expiresAt && grant.expiresAt <= this.now()) this.expire(grant);
      return back;
    }
    const writeOff = grant.status === 'voided' ? 'void' : 'expire';
    this.write({
      userId,
      grantId,
      leaseId,
      kind: writeOff,
      amount: -back,
      idempotencyKey: `${key}#${writeOff}`,
    });
    grant.remaining -= back;
    return back;
  }
}
