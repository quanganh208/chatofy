import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { expireDueGrants, writeEntries } from './credit-grant-ops';
import { CreditsLedger } from './credits-ledger.service';
import { runLedgerTransaction } from './ledger-transaction';
import { PlanCatalog } from './plan-catalog';
import { extendPass, grantForPlan, isGrantablePlan } from './plan-grant';

/** Grants expired per reaper tick at most, so one tick stays short. */
const EXPIRE_BATCH = 500;

export type VoidResult =
  | { state: 'voided'; userId: string; amount: number }
  | { state: 'already_voided' }
  | { state: 'not_found' };

export type ResolvePaymentResult =
  | { state: 'granted'; grantId: string; userId: string }
  | { state: 'dismissed' }
  | { state: 'not_reviewable'; status: string }
  | { state: 'not_found' };

/**
 * What the owner runs by hand (the credits CLI) and the reaper's expiry sweep:
 * voiding a grant, settling a payment that was not granted automatically, and
 * expiring due grants across all users. Each write takes the affected user's
 * advisory lock, like every other ledger write.
 */
@Injectable()
export class CreditOwnerTools {
  private readonly logger = new Logger(CreditOwnerTools.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanCatalog,
    private readonly ledger: CreditsLedger,
  ) {}

  /** Voids a grant: writes off what it still holds. Idempotent. */
  async voidGrant(
    grantId: string,
    reason?: string | null,
  ): Promise<VoidResult> {
    const target = await this.prisma.creditGrant.findUnique({
      where: { id: grantId },
      select: { userId: true },
    });
    if (!target) return { state: 'not_found' };
    return runLedgerTransaction(this.prisma, target.userId, async (tx) => {
      const grant = await tx.creditGrant.findUniqueOrThrow({
        where: { id: grantId },
        select: { status: true, remaining: true },
      });
      if (grant.status === 'voided') return { state: 'already_voided' };
      await writeEntries(tx, [
        {
          userId: target.userId,
          grantId,
          kind: 'void',
          amount: -grant.remaining,
          idempotencyKey: `void:${grantId}`,
          reason: reason ?? null,
        },
      ]);
      await tx.creditGrant.update({
        where: { id: grantId },
        data: { remaining: 0, status: 'voided' },
      });
      return {
        state: 'voided',
        userId: target.userId,
        amount: grant.remaining,
      };
    });
  }

  /** Expires due grants across all users, one user per transaction. */
  async expireDue(now = new Date()): Promise<number> {
    const due = await this.prisma.creditGrant.findMany({
      where: { status: 'active', expiresAt: { lte: now } },
      select: { userId: true },
      distinct: ['userId'],
      take: EXPIRE_BATCH,
    });
    let expired = 0;
    for (const { userId } of due) {
      try {
        expired += await runLedgerTransaction(this.prisma, userId, (tx) =>
          expireDueGrants(tx, userId, now),
        );
      } catch (err) {
        this.logger.warn(
          `expiring grants for user ${userId} failed: ${String(err)}`,
        );
      }
    }
    return expired;
  }

  /**
   * Settles a paid order that was not granted automatically (SePay or Polar).
   *
   * `grant` writes the order plan's grant to the order's user (or `userId`, for
   * a payment no account could be matched to) keyed on the order's payment
   * reference (`sepay:tx:<id>`, `polar:order:<id>`) — the same key the webhook
   * grants under — so a later webhook retry cannot grant it a second time. A
   * pass also moves the account's pass end, as the webhook would. `planCode`
   * grants a catalogue plan other than the one the order names (a transfer
   * whose amount matched no plan), and is recorded on the order. `dismiss`
   * only closes the review. Both are a compare-and-set on `needs_review`.
   */
  async resolvePayment(
    orderId: string,
    action: 'grant' | 'dismiss',
    options: {
      userId?: string;
      note?: string | null;
      planCode?: string;
    } = {},
  ): Promise<ResolvePaymentResult> {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) return { state: 'not_found' };
    if (order.status !== 'needs_review')
      return { state: 'not_reviewable', status: order.status };
    const note = options.note ?? null;
    const resolved = (status: string) => ({
      status,
      resolvedAt: new Date(),
      resolvedNote: note,
    });

    if (action === 'dismiss') {
      const done = await this.prisma.paymentOrder.updateMany({
        where: { id: orderId, status: 'needs_review' },
        data: resolved('resolved_dismissed'),
      });
      return done.count === 1
        ? { state: 'dismissed' }
        : { state: 'not_reviewable', status: 'changed' };
    }

    const userId = options.userId ?? order.userId;
    if (!userId)
      throw new Error('This order has no user; pass --user <email>.');
    if (!order.externalRef)
      throw new Error('This order has no payment reference to grant under.');
    const planCode = options.planCode ?? order.planCode;
    if (!planCode)
      throw new Error('This order names no plan; pass --plan <code>.');
    const plan = await this.plans.get(planCode);
    if (!plan) throw new Error(`No plan ${planCode} in the catalogue.`);
    if (!isGrantablePlan(plan))
      throw new Error(`Plan ${planCode} cannot be granted.`);
    const now = new Date();
    const grant = grantForPlan(plan, {
      userId,
      now,
      externalRef: order.externalRef,
      costBasis: order.paidAmountVnd ?? order.amountMinor,
      currency: order.currency,
      reason: note ? `resolve-payment: ${note}` : 'resolve-payment',
    });

    return runLedgerTransaction(this.prisma, userId, async (tx) => {
      const done = await tx.paymentOrder.updateMany({
        where: { id: orderId, status: 'needs_review' },
        data: { ...resolved('resolved_granted'), userId, planCode },
      });
      if (done.count !== 1)
        return { state: 'not_reviewable', status: 'changed' };
      const granted = await this.ledger.grant(grant, tx);
      if (
        granted.state === 'granted' &&
        plan.kind === 'pass' &&
        grant.expiresAt
      )
        await extendPass(tx, userId, now, grant.expiresAt);
      return { state: 'granted', grantId: granted.grantId, userId };
    });
  }
}
