import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { readBalance } from './credit-balance-read';
import {
  availableSeconds,
  nthKey,
  takeFromGrants,
  writeEntries,
} from './credit-grant-ops';
import { returnToGrants } from './credit-grant-return';
import {
  LedgerUnavailableError,
  type DebitInput,
  type DebitResult,
  type GrantInput,
  type GrantResult,
  type LedgerBalance,
  type RefundInput,
  type RefundResult,
} from './credit-ledger.port';
import { assertCreditSeconds } from './credit-spend';
import { ensureFreeGrant, prepareUser } from './free-grant';
import {
  isLedgerUnavailable,
  runLedgerRead,
  runLedgerTransaction,
  type LedgerTx,
} from './ledger-transaction';
import { PlanCatalog } from './plan-catalog';

/**
 * The Prisma ledger: balances, grants, debits and refunds. Leases live in
 * `CreditLeases`, the owner's void and payment-review tools in
 * `CreditOwnerTools`.
 *
 * Every write that spends is one `runLedgerTransaction` under the user's
 * advisory lock. The balance read takes no lock: it is polled by every client
 * and must not queue behind the live meter.
 */
@Injectable()
export class CreditsLedger {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanCatalog,
  ) {}

  /**
   * The Free allowance in credit-seconds, read before a transaction opens.
   * The read sits outside the transactions that map an outage, so it maps its
   * own: a database that cannot be reached is `LedgerUnavailableError` (503),
   * the same as it would be one step later.
   */
  async freeAmount(): Promise<number> {
    try {
      return await this.plans.freeCreditSeconds();
    } catch (err) {
      if (isLedgerUnavailable(err))
        throw new LedgerUnavailableError({ cause: err });
      throw err;
    }
  }

  /**
   * The balance, without the user lock. This month's Free grant is written
   * here only when it is missing, idempotently (see `ensureFreeGrant`), in its
   * own short transaction; due grants are not expired here — the read leaves
   * them out, and the reaper and the next spend mark them. The read itself is
   * one REPEATABLE READ snapshot, so grants and leases agree with each other.
   */
  async balance(userId: string): Promise<LedgerBalance> {
    const freeAmount = await this.freeAmount();
    const now = new Date();
    await runLedgerRead(this.prisma, (tx) =>
      ensureFreeGrant(tx, userId, now, freeAmount),
    );
    return runLedgerRead(
      this.prisma,
      (tx) => readBalance(tx, userId, now),
      Prisma.TransactionIsolationLevel.RepeatableRead,
    );
  }

  async grant(input: GrantInput, tx?: LedgerTx): Promise<GrantResult> {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      throw new RangeError(
        `grant amount must be a positive integer, got ${input.amount}`,
      );
    }
    assertCreditSeconds(input.costBasis ?? 0, 'costBasis');
    if (tx) return this.writeGrant(tx, input);
    return runLedgerTransaction(this.prisma, input.userId, (own) =>
      this.writeGrant(own, input),
    );
  }

  private async writeGrant(
    tx: LedgerTx,
    input: GrantInput,
  ): Promise<GrantResult> {
    // skipDuplicates is ON CONFLICT DO NOTHING: a replayed grant is reported
    // instead of raising P2002, which would abort a caller's transaction.
    const created = await tx.creditGrant.createManyAndReturn({
      data: [
        {
          userId: input.userId,
          source: input.source,
          planCode: input.planCode ?? null,
          amount: input.amount,
          remaining: input.amount,
          startsAt: input.startsAt ?? null,
          expiresAt: input.expiresAt ?? null,
          costBasis: input.costBasis ?? 0,
          currency: input.currency ?? null,
          externalRef: input.externalRef,
        },
      ],
      skipDuplicates: true,
      select: { id: true },
    });
    const grantId = created[0]?.id;
    if (!grantId) {
      const existing = await tx.creditGrant.findUniqueOrThrow({
        where: { externalRef: input.externalRef },
        select: { id: true },
      });
      return { state: 'duplicate', grantId: existing.id };
    }
    await writeEntries(tx, [
      {
        userId: input.userId,
        grantId,
        kind: 'grant',
        amount: input.amount,
        idempotencyKey: `grant:${input.externalRef}`,
        reason: input.reason ?? null,
      },
    ]);
    return { state: 'granted', grantId };
  }

  async debit(input: DebitInput): Promise<DebitResult> {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      throw new RangeError(
        `debit amount must be a positive integer, got ${input.amount}`,
      );
    }
    const freeAmount = await this.freeAmount();
    return runLedgerTransaction(this.prisma, input.userId, async (tx) => {
      const now = new Date();
      const seen = await tx.creditEntry.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });
      if (seen) {
        return {
          state: 'ok',
          duplicate: true,
          available: await availableSeconds(tx, input.userId, now),
        };
      }
      await prepareUser(tx, input.userId, now, freeAmount);
      const available = await availableSeconds(tx, input.userId, now);
      if (available < input.amount) return { state: 'insufficient', available };
      await takeFromGrants(tx, {
        userId: input.userId,
        want: input.amount,
        kind: 'debit',
        keyBase: input.idempotencyKey,
        now,
        sessionId: input.sessionId,
        conversationId: input.conversationId,
        reason: input.reason,
      });
      return {
        state: 'ok',
        duplicate: false,
        available: available - input.amount,
      };
    });
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    return runLedgerTransaction(this.prisma, input.userId, async (tx) => {
      const now = new Date();
      const seen = await tx.creditEntry.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });
      if (seen) return { state: 'ok', refunded: 0, duplicate: true };
      const debits = await tx.creditEntry.findMany({
        where: {
          userId: input.userId,
          kind: 'debit',
          OR: [
            { idempotencyKey: input.debitKey },
            { idempotencyKey: { startsWith: `${input.debitKey}#` } },
          ],
        },
        orderBy: { idempotencyKey: 'asc' },
        select: { grantId: true, amount: true },
      });
      const parts = debits
        .filter(
          (d): d is { grantId: string; amount: number } => d.grantId !== null,
        )
        .map((d, index) => ({
          grantId: d.grantId,
          back: -d.amount,
          idempotencyKey: nthKey(input.idempotencyKey, index),
        }));
      const refunded = await returnToGrants(tx, {
        userId: input.userId,
        kind: 'refund',
        parts,
        now,
        reason: input.reason,
      });
      return { state: 'ok', refunded, duplicate: false };
    });
  }
}
