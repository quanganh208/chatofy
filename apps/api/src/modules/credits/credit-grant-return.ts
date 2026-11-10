import { expireGrant, writeEntries, type EntryKind } from './credit-grant-ops';
import type { LedgerTx } from './ledger-transaction';

// Credit going back onto the grants it was taken from: a lease's release and a
// debit's refund. Assumes the caller holds the user's advisory lock.

export interface ReturnPart {
  grantId: string;
  back: number;
  idempotencyKey: string;
}

/**
 * Puts credit back on the grants it came from (a release or a refund).
 *
 * A grant that expired or was voided while its credit was held still gets the
 * entry — the history stays complete — and the amount is written off again at
 * once with the matching kind, so nothing is revived. A grant that is past its
 * expiry but not yet marked is expired now, the returned amount with it.
 */
export async function returnToGrants(
  tx: LedgerTx,
  input: {
    userId: string;
    kind: 'release' | 'refund';
    parts: ReturnPart[];
    now: Date;
    leaseId?: string | null;
    reason?: string | null;
  },
): Promise<number> {
  let returned = 0;
  for (const part of input.parts) {
    if (part.back <= 0) continue;
    const grant = await tx.creditGrant.update({
      where: { id: part.grantId },
      data: { remaining: { increment: part.back } },
      select: { id: true, status: true, remaining: true, expiresAt: true },
    });
    await writeEntries(tx, [
      {
        userId: input.userId,
        grantId: grant.id,
        leaseId: input.leaseId ?? null,
        kind: input.kind,
        amount: part.back,
        idempotencyKey: part.idempotencyKey,
        reason: input.reason ?? null,
      },
    ]);
    returned += part.back;
    if (grant.status === 'active') {
      if (grant.expiresAt && grant.expiresAt <= input.now) {
        await expireGrant(tx, input.userId, grant);
      }
      continue;
    }
    const writeOff: EntryKind = grant.status === 'voided' ? 'void' : 'expire';
    await writeEntries(tx, [
      {
        userId: input.userId,
        grantId: grant.id,
        leaseId: input.leaseId ?? null,
        kind: writeOff,
        amount: -part.back,
        idempotencyKey: `${part.idempotencyKey}#${writeOff}`,
      },
    ]);
    await tx.creditGrant.update({
      where: { id: grant.id },
      data: { remaining: { decrement: part.back } },
    });
  }
  return returned;
}
