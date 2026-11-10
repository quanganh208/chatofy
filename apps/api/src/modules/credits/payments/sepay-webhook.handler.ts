import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CREDIT_LEDGER, type CreditLedgerPort } from '../credit-ledger.port';
import type { LedgerTx } from '../ledger-transaction';
import { PlanCatalog } from '../plan-catalog';
import { extendPass, grantForPlan } from '../plan-grant';
import { CheckoutAllowlist } from './checkout-allowlist';
import {
  decideTransfer,
  orderCodeOf,
  sepayTransferSchema,
  type ReviewReason,
  type SepayTransfer,
} from './sepay-webhook-payload';
import { SepayProvider } from './sepay-provider';
import {
  markSepayReview,
  recordSepayReview,
  settleSepayOrder,
  type SepayReviewOrder,
} from './sepay-review-rows';
import { WebhookInbox, type InboxResult } from './webhook-inbox';

/**
 * Turns a verified SePay transfer into a grant, or into a payment the owner
 * reviews: wrong amount, unknown code, an account no longer allowlisted (see
 * `payment-review-rows.ts`).
 */
@Injectable()
export class SepayWebhookHandler {
  private readonly logger = new Logger(SepayWebhookHandler.name);

  constructor(
    private readonly inbox: WebhookInbox,
    @Inject(CREDIT_LEDGER) private readonly ledger: CreditLedgerPort,
    private readonly plans: PlanCatalog,
    private readonly sepay: SepayProvider,
    private readonly allowlist: CheckoutAllowlist,
    private readonly prisma: PrismaService,
  ) {}

  /** Handles one verified delivery. Throws only on a database fault (SePay then retries). */
  async receive(rawBody: Buffer): Promise<InboxResult> {
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      json = null;
    }
    const parsed = sepayTransferSchema.safeParse(json);
    if (!parsed.success) {
      this.logger.error(
        'sepay webhook: signed payload missing required fields, acknowledged without action',
      );
      return { duplicate: false, outcome: 'unparsed' };
    }
    const transfer = parsed.data;
    const code = orderCodeOf(transfer, this.sepay.orderPrefix);
    // Read outside the transaction only to choose whose lock to take; the
    // order is read again under that lock.
    const owner = code
      ? await this.prisma.paymentOrder.findUnique({
          where: { orderCode: code },
          select: { userId: true },
        })
      : null;
    return this.inbox.process(
      {
        provider: 'sepay',
        eventId: transfer.id,
        objectId: transfer.id,
        type: `transfer.${transfer.transferType}`,
        lockKey: owner?.userId ?? 'sepay:unmatched',
      },
      (tx) => this.transfer(tx, transfer, code),
    );
  }

  private async transfer(
    tx: LedgerTx,
    transfer: SepayTransfer,
    code: string | null,
  ): Promise<string> {
    if (transfer.transferType !== 'in') return 'ignored';
    const ref = `sepay:tx:${transfer.id}`;
    const now = new Date();
    const order = code
      ? await tx.paymentOrder.findUnique({ where: { orderCode: code } })
      : null;
    if (!order || order.provider !== 'sepay' || !order.userId) {
      const id = await recordSepayReview(tx, transfer, ref, now, {
        userId: null,
        planCode: await this.planCodeForAmount(transfer.transferAmount),
        reason: 'unknown_code',
      });
      this.logger.warn(
        `sepay tx ${transfer.id}: memo code ${code ?? '-'} matches no order; ${transfer.transferAmount}đ recorded for review as ${id}`,
      );
      return 'review_unknown_code';
    }

    const allowlisted = await this.allowlist.allowsUser(order.userId, tx);
    const decision = decideTransfer(order, transfer, allowlisted, now);
    if (decision.action === 'review') {
      await this.review(tx, order, transfer, ref, now, decision.reason);
      return `review_${decision.reason}`;
    }

    // The order keeps the plan it was created for even while an earlier
    // transfer for it is in review, and this transfer paid exactly its price.
    const planCode = order.planCode;
    const plan = planCode ? await this.plans.get(planCode) : undefined;
    if (!plan || (plan.kind !== 'topup' && plan.kind !== 'pass')) {
      // The order was created from this plan; losing it is a deploy fault, and
      // failing makes SePay retry once it is fixed.
      throw new Error(
        `sepay order ${order.id} names plan ${planCode ?? '-'}, which cannot be granted`,
      );
    }
    const grant = grantForPlan(
      { ...plan, kind: plan.kind },
      {
        userId: order.userId,
        now,
        externalRef: ref,
        costBasis: transfer.transferAmount,
        currency: 'VND',
        reason: `sepay ${plan.code}`,
      },
    );
    const granted = await this.ledger.grant(grant, tx);
    if (grant.expiresAt)
      await extendPass(tx, order.userId, now, grant.expiresAt);
    await settleSepayOrder(tx, order, transfer, ref, now, (amount) =>
      this.planCodeForAmount(amount),
    );
    const late =
      decision.lateBySeconds > 0
        ? ` late by ${decision.lateBySeconds}s after the order expired`
        : '';
    this.logger.log(
      `sepay tx ${transfer.id}: order ${order.id} granted ${plan.code} to ${order.userId}${late}`,
    );
    return granted.state === 'duplicate' ? 'duplicate_grant' : 'granted';
  }

  /** Puts a matched order's transfer up for review and says so. */
  private async review(
    tx: LedgerTx,
    order: SepayReviewOrder,
    transfer: SepayTransfer,
    ref: string,
    now: Date,
    reason: ReviewReason,
  ): Promise<void> {
    const id = await markSepayReview(tx, {
      order,
      transfer,
      ref,
      now,
      reason,
      planCodeForAmount: (amount) => this.planCodeForAmount(amount),
    });
    this.logger.warn(
      `sepay tx ${transfer.id}: order ${order.id} ${reason} (asked ${order.amountVnd ?? '-'}đ, paid ${transfer.transferAmount}đ); nothing granted, review ${id}`,
    );
  }

  /**
   * The SePay plan priced at exactly this amount, so the owner can grant an
   * unmatched transfer with `credits:resolve-payment` without naming a plan.
   */
  private planCodeForAmount(amountVnd: number): Promise<string | null> {
    return this.plans.sepayPlanCodeForAmount(amountVnd);
  }
}
