import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { runLedgerTransaction, type LedgerTx } from '../ledger-transaction';

export interface WebhookDelivery {
  provider: 'polar' | 'sepay';
  /** The provider's delivery id, stable across its retries. */
  eventId: string;
  /** The object the event is about (order, subscription, transfer). */
  objectId: string;
  type: string;
  /**
   * Whose advisory lock the transaction takes: the user a grant is for, so the
   * grant serialises with every other ledger write of that user.
   */
  lockKey: string;
}

export type InboxResult =
  { duplicate: true } | { duplicate: false; outcome: string };

/**
 * Records a verified delivery and handles it in ONE transaction.
 *
 * The dedup row is written in the same transaction as the grant it leads to.
 * If the grant fails, the row rolls back with it, so the provider's retry is
 * processed again instead of being acknowledged as a duplicate of something
 * that never happened. A replay finds the row and writes nothing.
 *
 * `ON CONFLICT DO NOTHING` rather than catching a unique violation: a P2002
 * would abort the transaction, which Postgres then refuses to use for anything.
 */
@Injectable()
export class WebhookInbox {
  constructor(private readonly prisma: PrismaService) {}

  process(
    delivery: WebhookDelivery,
    handle: (tx: LedgerTx) => Promise<string>,
  ): Promise<InboxResult> {
    return runLedgerTransaction(this.prisma, delivery.lockKey, async (tx) => {
      const inserted = await tx.webhookEvent.createManyAndReturn({
        data: [
          {
            provider: delivery.provider,
            eventId: delivery.eventId,
            objectId: delivery.objectId,
            type: delivery.type,
            outcome: 'processing',
          },
        ],
        skipDuplicates: true,
        select: { id: true },
      });
      const eventRowId = inserted[0]?.id;
      if (!eventRowId) return { duplicate: true };
      const outcome = await handle(tx);
      await tx.webhookEvent.update({
        where: { id: eventRowId },
        data: { outcome },
      });
      return { duplicate: false, outcome };
    });
  }
}
