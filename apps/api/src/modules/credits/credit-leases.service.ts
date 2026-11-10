import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { availableSeconds } from './credit-grant-ops';
import {
  leaseExpiry,
  NOT_OPEN,
  releaseLease,
  reserveForLease,
  settleOnLease,
  touchIfOpen,
} from './credit-lease-ops';
import type {
  CloseState,
  LeaseState,
  NotOpen,
  SettleInput,
  SettleState,
} from './credit-ledger.port';
import { assertCreditSeconds } from './credit-spend';
import { CreditsLedger } from './credits-ledger.service';
import { prepareUser } from './free-grant';
import { runLedgerTransaction } from './ledger-transaction';

/** Leases reaped per tick at most. */
const REAP_BATCH = 200;

/**
 * Credit held by live connections.
 *
 * A reserve takes real credit out of the grants, so twenty parallel connections
 * can never each believe they hold the whole balance. Every mutation after
 * `open` is a compare-and-set on `status = 'open'` under the user's advisory
 * lock, and the reaper takes the same lock with the same CAS: a lease reaped
 * while its socket idled answers `not_open` to a late extend, settle or close,
 * and its unspent credit is released exactly once.
 */
@Injectable()
export class CreditLeases {
  private readonly logger = new Logger(CreditLeases.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: CreditsLedger,
  ) {}

  async open(userId: string, want: number): Promise<LeaseState> {
    assertCreditSeconds(want, 'want');
    const freeAmount = await this.ledger.freeAmount();
    return runLedgerTransaction(this.prisma, userId, async (tx) => {
      const now = new Date();
      await prepareUser(tx, userId, now, freeAmount);
      const lease = await tx.creditLease.create({
        data: { userId, expiresAt: leaseExpiry(now) },
        select: { id: true },
      });
      const granted = await reserveForLease(
        tx,
        userId,
        lease.id,
        want,
        `reserve:${lease.id}:${randomUUID()}`,
        now,
      );
      await tx.creditLease.update({
        where: { id: lease.id },
        data: { held: granted },
      });
      return {
        state: 'ok',
        leaseId: lease.id,
        held: granted,
        consumed: 0,
        granted,
        available: await availableSeconds(tx, userId, now),
      };
    });
  }

  async extend(leaseId: string, want: number): Promise<LeaseState | NotOpen> {
    assertCreditSeconds(want, 'want');
    const userId = await this.ownerOf(leaseId);
    if (!userId) return NOT_OPEN;
    const freeAmount = await this.ledger.freeAmount();
    return runLedgerTransaction(this.prisma, userId, async (tx) => {
      const now = new Date();
      if (!(await touchIfOpen(tx, leaseId, now))) return NOT_OPEN;
      await prepareUser(tx, userId, now, freeAmount);
      const granted = await reserveForLease(
        tx,
        userId,
        leaseId,
        want,
        `reserve:${leaseId}:${randomUUID()}`,
        now,
      );
      const lease = await tx.creditLease.update({
        where: { id: leaseId },
        data: { held: { increment: granted } },
        select: { held: true, consumed: true },
      });
      return {
        state: 'ok',
        leaseId,
        held: lease.held,
        consumed: lease.consumed,
        granted,
        available: await availableSeconds(tx, userId, now),
      };
    });
  }

  /** Records what a turn consumed; see `settleOnLease` for how it is charged. */
  async settle(input: SettleInput): Promise<SettleState | NotOpen> {
    assertCreditSeconds(input.seconds, 'seconds');
    const key = input.idempotencyKey ?? `settle:${input.sessionId}`;
    const userId = await this.ownerOf(input.leaseId);
    if (!userId) return NOT_OPEN;
    const freeAmount = await this.ledger.freeAmount();
    return runLedgerTransaction(this.prisma, userId, (tx) =>
      settleOnLease(tx, userId, { ...input, key, freeAmount }, new Date()),
    );
  }

  async close(leaseId: string): Promise<CloseState | NotOpen> {
    const userId = await this.ownerOf(leaseId);
    if (!userId) return NOT_OPEN;
    return runLedgerTransaction(this.prisma, userId, async (tx) => {
      const now = new Date();
      const done = await tx.creditLease.updateMany({
        where: { id: leaseId, status: 'open' },
        data: { status: 'closed', closedAt: now },
      });
      if (done.count === 0) return NOT_OPEN;
      return {
        state: 'ok',
        released: await releaseLease(tx, userId, leaseId, now),
      };
    });
  }

  /**
   * Takes back leases whose connection stopped touching them: one lease per
   * transaction, under that user's lock, CAS `open → reaped` re-checking the
   * expiry (a settle may have bumped it since the candidate was read).
   */
  async reapExpired(now = new Date()): Promise<number> {
    const candidates = await this.prisma.creditLease.findMany({
      where: { status: 'open', expiresAt: { lt: now } },
      select: { id: true, userId: true },
      take: REAP_BATCH,
    });
    let reaped = 0;
    for (const lease of candidates) {
      try {
        const released = await runLedgerTransaction(
          this.prisma,
          lease.userId,
          async (tx) => {
            const done = await tx.creditLease.updateMany({
              where: { id: lease.id, status: 'open', expiresAt: { lt: now } },
              data: { status: 'reaped', closedAt: new Date() },
            });
            if (done.count === 0) return null;
            return releaseLease(tx, lease.userId, lease.id, new Date());
          },
        );
        if (released !== null) reaped += 1;
      } catch (err) {
        this.logger.warn(`reaping lease ${lease.id} failed: ${String(err)}`);
      }
    }
    return reaped;
  }

  private async ownerOf(leaseId: string): Promise<string | null> {
    const lease = await this.prisma.creditLease.findUnique({
      where: { id: leaseId },
      select: { userId: true },
    });
    return lease?.userId ?? null;
  }
}
