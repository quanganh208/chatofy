import type { Logger } from '@nestjs/common';
import type { ServerEvent } from '@chatofy/types';
import type { StreamSocket } from '../translate/session/stream-socket';

// One socket's credit state for the translation meter, and the arithmetic over
// it. Every amount is credit-seconds: accepted audio seconds × the turn's
// multiplier. Nothing here touches the ledger.

/** Why a connection's turns were stopped by the meter. */
export type CreditStopReason = 'credits_exhausted' | 'credits_unavailable';

export type CreditAdmission =
  | { admitted: true }
  | {
      admitted: false;
      code: CreditStopReason;
      remainingCreditSeconds: number;
    };

export interface MeteredTurn {
  audioSeconds: number;
  multiplier: number;
  conversationId?: string;
}

export interface SettleJob {
  sessionId: string;
  conversationId?: string;
  credits: number;
  /** Defaults to the turn's own `settle:<sessionId>`. */
  idempotencyKey?: string;
}

/** One socket's credit, for the socket's lifetime. Nothing here is shared across users. */
export interface ConnectionCredit {
  userId: string;
  onStop: (reason: CreditStopReason) => void;
  leaseId?: string;
  /** Mirror of the lease: credit-seconds it holds and has had settled against it. */
  held: number;
  consumed: number;
  /** Turns that ended and whose settle is in flight. */
  settling: number;
  /**
   * The fraction of a credit-second ended turns consumed beyond what was
   * settled. The ledger moves whole credit-seconds, so each turn settles the
   * whole part of (its usage + this) and carries the rest to the next; the
   * last remainder is settled, rounded, when the socket goes. Without it every
   * turn under half a credit-second would be free.
   */
  carry: number;
  /** The last turn that ended, which the final remainder is settled under. */
  lastTurn?: { sessionId: string; conversationId?: string };
  /** Spendable outside the lease, as of the last ledger answer. */
  available: number;
  turns: Map<string, MeteredTurn>;
  /** Every ledger call in flight, so `detach` can wait for them before closing. */
  pending: Set<Promise<unknown>>;
  /** The extend in flight; every caller that needs one awaits this one. */
  extending?: Promise<void>;
  /** The last extend granted nothing: no more are tried until a new start asks. */
  starved: boolean;
  /** Fail-open credit granted when an extend threw; 0 when the ledger is answering. */
  virtual: number;
  outage: boolean;
  retryAttempt: number;
  retryTimer?: ReturnType<typeof setTimeout>;
  reopening?: Promise<void>;
  failedSettles: SettleJob[];
  exhausted: boolean;
  warned: boolean;
  detached: boolean;
}

export function newConnection(
  userId: string,
  onStop: (reason: CreditStopReason) => void,
): ConnectionCredit {
  return {
    userId,
    onStop,
    held: 0,
    consumed: 0,
    settling: 0,
    carry: 0,
    available: 0,
    turns: new Map(),
    pending: new Set(),
    starved: false,
    virtual: 0,
    outage: false,
    retryAttempt: 0,
    failedSettles: [],
    exhausted: false,
    warned: false,
    detached: false,
  };
}

/** Credit-seconds the lease (plus any fail-open credit) has left. */
export function headroom(conn: ConnectionCredit): number {
  let live = 0;
  for (const turn of conn.turns.values()) {
    live += turn.audioSeconds * turn.multiplier;
  }
  return (
    conn.held + conn.virtual - conn.consumed - conn.settling - conn.carry - live
  );
}

/** What the user can still spend: outside the lease plus what the lease has left. */
export function remaining(conn: ConnectionCredit): number {
  return Math.max(0, Math.floor(conn.available + headroom(conn)));
}

/** The highest multiplier among the connection's live turns (1 with none). */
export function liveMultiplier(conn: ConnectionCredit): number {
  return Math.max(1, ...[...conn.turns.values()].map((t) => t.multiplier));
}

/** The client-facing text for each stop; clients localise by `code`. */
export const MESSAGES: Record<CreditStopReason, string> = {
  credits_exhausted: 'You are out of credits',
  credits_unavailable: 'Credits cannot be checked right now; try again shortly',
};

export function refusal(
  code: CreditStopReason,
  remainingCreditSeconds: number,
): CreditAdmission {
  return { admitted: false, code, remainingCreditSeconds };
}

export function emit(
  socket: StreamSocket,
  logger: Logger,
  event: ServerEvent,
): void {
  try {
    socket.send(JSON.stringify(event));
  } catch (err) {
    logger.warn(`dropped ${event.type}: ${describe(err)}`);
  }
}

export function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Cancels a scheduled extend retry, if any. */
export function clearRetry(conn: ConnectionCredit): void {
  if (conn.retryTimer) clearTimeout(conn.retryTimer);
  conn.retryTimer = undefined;
}

/** Remember a ledger call so `detach` waits for it. The promise itself is returned unchanged. */
export function track<T>(conn: ConnectionCredit, work: Promise<T>): Promise<T> {
  conn.pending.add(work);
  const forget = () => conn.pending.delete(work);
  work.then(forget, forget);
  return work;
}
