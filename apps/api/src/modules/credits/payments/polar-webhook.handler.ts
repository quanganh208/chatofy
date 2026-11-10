import { Inject, Injectable, Logger } from '@nestjs/common';
import { expireGrant } from '../credit-grant-ops';
import { CREDIT_LEDGER, type CreditLedgerPort } from '../credit-ledger.port';
import type { LedgerTx } from '../ledger-transaction';
import { PlanCatalog } from '../plan-catalog';
import { CheckoutAllowlist } from './checkout-allowlist';
import {
  recordPaymentReview,
  type PaymentReviewReason,
} from './payment-review-rows';
import {
  decideOrderPaid,
  polarReviewRow,
  polarEnvelopeSchema,
  polarOrderSchema,
  polarSubscriptionSchema,
  polarUserOf,
  SUBSCRIPTION_STATE_EVENTS,
  type PolarOrder,
  type PolarSubscription,
} from './polar-webhook-payload';
import { PolarProvider } from './polar-provider';
import { WebhookInbox, type InboxResult } from './webhook-inbox';

/**
 * Turns a verified Polar delivery into ledger and subscription writes.
 *
 * Deliveries arrive out of order and are redelivered late, so nothing here
 * reads "the subscription now": a Pro grant takes its period from the order,
 * renewal expires only grants whose period ended by this one's start, and a
 * subscription event older than the stored one changes nothing.
 */
@Injectable()
export class PolarWebhookHandler {
  private readonly logger = new Logger(PolarWebhookHandler.name);

  constructor(
    private readonly inbox: WebhookInbox,
    @Inject(CREDIT_LEDGER) private readonly ledger: CreditLedgerPort,
    private readonly plans: PlanCatalog,
    private readonly polar: PolarProvider,
    private readonly allowlist: CheckoutAllowlist,
  ) {}

  /**
   * Handles one delivery whose signature has been verified. Throws only on a
   * database fault, which the route answers with 5xx so Polar retries.
   */
  async receive(webhookId: string, rawBody: Buffer): Promise<InboxResult> {
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      json = null;
    }
    const envelope = polarEnvelopeSchema.safeParse(json);
    if (!envelope.success) {
      // Signed by Polar but not a shape we know: retrying cannot fix it, and
      // failing would count toward the endpoint being disabled.
      this.logger.warn(
        `polar webhook ${webhookId}: unreadable envelope, acknowledged`,
      );
      return { duplicate: false, outcome: 'unparsed' };
    }
    const { type, data } = envelope.data;
    const delivery = {
      provider: 'polar' as const,
      eventId: webhookId,
      objectId: data.id,
      type,
    };

    if (type === 'order.paid') {
      const order = polarOrderSchema.safeParse(data);
      if (!order.success) return this.unparsed(webhookId, type);
      const userId = polarUserOf(order.data);
      return this.inbox.process(
        { ...delivery, lockKey: userId ?? `polar:${order.data.id}` },
        (tx) => this.orderPaid(tx, order.data, userId),
      );
    }
    if (SUBSCRIPTION_STATE_EVENTS.has(type)) {
      const sub = polarSubscriptionSchema.safeParse(data);
      if (!sub.success) return this.unparsed(webhookId, type);
      const userId = polarUserOf(sub.data);
      return this.inbox.process(
        { ...delivery, lockKey: userId ?? `polar:${sub.data.id}` },
        (tx) => this.subscriptionState(tx, sub.data, userId),
      );
    }
    return this.inbox.process(
      { ...delivery, lockKey: `polar:${data.id}` },
      async () => {
        if (type.startsWith('refund.')) {
          // Real-money refunds are handled by hand; the delivery is kept as a record.
          this.logger.log(
            `polar ${type} for ${data.id} recorded, nothing granted or voided`,
          );
          return 'logged';
        }
        return 'ignored';
      },
    );
  }

  private unparsed(webhookId: string, type: string): InboxResult {
    this.logger.error(
      `polar webhook ${webhookId} (${type}): payload missing required fields, acknowledged without action`,
    );
    return { duplicate: false, outcome: 'unparsed' };
  }

  private async orderPaid(
    tx: LedgerTx,
    order: PolarOrder,
    userId: string | null,
  ): Promise<string> {
    const planCode = this.polar.planCodeForProduct(order.product_id);
    if (!userId) {
      await this.review(tx, order, 'user_mismatch', null, planCode);
      return 'refused_user_mismatch';
    }
    if (!(await this.allowlist.allowsUser(userId, tx))) {
      await this.review(tx, order, 'refused_allowlist', userId, planCode);
      return 'refused_allowlist';
    }
    const plan = planCode ? await this.plans.get(planCode) : undefined;
    const decision = decideOrderPaid(order, userId, plan);
    if (decision.action === 'skip') {
      if (decision.outcome === 'unknown_product') {
        await this.review(tx, order, 'unknown_product', userId, null);
      }
      return decision.outcome;
    }
    const result = await this.ledger.grant(decision.grant, tx);
    if (result.state === 'duplicate') return 'duplicate_grant';
    if (decision.grant.source === 'subscription' && decision.grant.startsAt) {
      // The renewal "expires the old remainder": only periods that ended by
      // this one's start, so a late order for an older period never cuts a
      // newer one short.
      const older = await tx.creditGrant.findMany({
        where: {
          userId,
          source: 'subscription',
          status: 'active',
          id: { not: result.grantId },
          expiresAt: { lte: decision.grant.startsAt },
        },
        select: { id: true, remaining: true },
      });
      for (const grant of older) await expireGrant(tx, userId, grant);
    }
    this.logger.log(
      `polar order ${order.id}: granted ${decision.grant.planCode} to ${userId}`,
    );
    return 'granted';
  }

  /** A paid order that was not granted becomes a review row (`polarReviewRow`). */
  private async review(
    tx: LedgerTx,
    order: PolarOrder,
    reason: PaymentReviewReason,
    userId: string | null,
    planCode: string | null,
  ): Promise<void> {
    const subject = `polar order ${order.id} (${reason}, product ${order.product_id ?? '-'}, account ${order.customer?.external_id ?? '-'})`;
    const row = polarReviewRow(order, reason, userId, planCode, new Date());
    if (!row) {
      this.logger.warn(`${subject}: nothing granted, nothing paid`);
      return;
    }
    const id = await recordPaymentReview(tx, row);
    this.logger.warn(
      `${subject}: ${order.total_amount} ${order.currency} paid, nothing granted, review ${id}`,
    );
  }

  private async subscriptionState(
    tx: LedgerTx,
    sub: PolarSubscription,
    userId: string | null,
  ): Promise<string> {
    if (!userId) {
      this.logger.warn(
        `polar subscription ${sub.id}: no customer.external_id, or it differs from metadata.userId; ignored`,
      );
      return 'refused_user_mismatch';
    }
    const modifiedAt = sub.modified_at ?? sub.created_at;
    const stored = await tx.subscription.findUnique({
      where: { externalId: sub.id },
      select: { providerUpdatedAt: true },
    });
    if (stored?.providerUpdatedAt && modifiedAt < stored.providerUpdatedAt) {
      return 'stale';
    }
    const state = {
      userId,
      status: sub.status,
      currentPeriodStart: sub.current_period_start ?? null,
      currentPeriodEnd: sub.current_period_end ?? null,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      providerUpdatedAt: modifiedAt,
    };
    await tx.subscription.upsert({
      where: { externalId: sub.id },
      create: { provider: 'polar', externalId: sub.id, ...state },
      update: state,
    });
    return 'subscription_updated';
  }
}
