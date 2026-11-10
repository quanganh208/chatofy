import type { CreditLedgerPort, LeaseState } from './credit-ledger.port';
import {
  clearRetry,
  type ConnectionCredit,
  type SettleJob,
} from './meter-connection';
import type { UserLedgerGate } from './user-ledger-gate';

/**
 * Keeps a connection's lease mirror in step with the ledger: opening,
 * extending, settling and closing the lease. Every ledger call goes through
 * the per-user gate, so one account's sockets cannot hold more than the gate's
 * share of the database pool. Errors propagate; the meter decides what an
 * outage means for the connection.
 */
export class MeterLeaseSync {
  constructor(
    private readonly ledger: CreditLedgerPort,
    private readonly gate: UserLedgerGate,
  ) {}

  /**
   * Extend the lease by `want`, reopening one the reaper took. Single flight:
   * a caller that finds an extend in flight (the admit path and the background
   * extend alike) awaits that one rather than start a second, whose answer
   * could land out of order and leave the mirrored `held` stale-low.
   */
  extend(conn: ConnectionCredit, want: number): Promise<void> {
    if (conn.extending) return conn.extending;
    conn.extending = (async () => {
      const leaseId = conn.leaseId;
      const result = leaseId
        ? await this.gate.run(conn.userId, () =>
            this.ledger.extendLease(leaseId, want),
          )
        : ({ state: 'not_open' } as const);
      if (result.state === 'not_open') await this.reopen(conn, leaseId, want);
      else applyLease(conn, result);
      conn.outage = false;
      conn.virtual = 0;
      conn.retryAttempt = 0;
      clearRetry(conn);
    })().finally(() => {
      conn.extending = undefined;
    });
    return conn.extending;
  }

  /**
   * Open a fresh lease in place of `stale` (undefined: the first one). Single
   * flight: concurrent callers that found the same lease closed share one open.
   */
  reopen(
    conn: ConnectionCredit,
    stale: string | undefined,
    want: number,
  ): Promise<void> {
    if (conn.reopening) return conn.reopening;
    if (conn.leaseId !== undefined && conn.leaseId !== stale) {
      return Promise.resolve();
    }
    conn.reopening = (async () => {
      const lease = await this.gate.run(conn.userId, () =>
        this.ledger.openLease(conn.userId, want),
      );
      conn.leaseId = lease.leaseId;
      conn.consumed = 0;
      conn.held = lease.held;
      conn.available = lease.available;
      conn.starved = want > 0 && lease.granted === 0;
    })().finally(() => {
      conn.reopening = undefined;
    });
    return conn.reopening;
  }

  /** Settle on the current lease; one the reaper took is reopened and settled there. */
  async settleOnce(conn: ConnectionCredit, job: SettleJob): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!conn.leaseId) await this.reopen(conn, undefined, 0);
      const leaseId = conn.leaseId!;
      const result = await this.gate.run(conn.userId, () =>
        this.ledger.settleLease({
          leaseId,
          seconds: job.credits,
          sessionId: job.sessionId,
          conversationId: job.conversationId ?? null,
          idempotencyKey: job.idempotencyKey,
        }),
      );
      if (result.state === 'not_open') {
        await this.reopen(conn, leaseId, 0);
        continue;
      }
      if (conn.leaseId === leaseId) {
        conn.consumed += result.covered;
        // An overshoot the grants covered grew the lease to match.
        conn.held = Math.max(conn.held, conn.consumed);
      }
      conn.available = result.available;
      return;
    }
    throw new Error('the lease closed again while settling');
  }

  /** Close the lease and give back the rest; `not_open` means the reaper already did. */
  async close(conn: ConnectionCredit, leaseId: string): Promise<void> {
    await this.gate.run(conn.userId, () => this.ledger.closeLease(leaseId));
  }
}

function applyLease(conn: ConnectionCredit, lease: LeaseState): void {
  conn.held = lease.held;
  conn.available = lease.available;
  conn.starved = lease.granted === 0;
}
