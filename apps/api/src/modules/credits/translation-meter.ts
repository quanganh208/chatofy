import { Inject, Injectable, Logger } from '@nestjs/common';
import type { StreamSocket } from '../translate/session/stream-socket';
import { CREDIT_LEDGER, type CreditLedgerPort } from './credit-ledger.port';
import {
  LEASE_AUDIO_SECONDS,
  START_MIN_CREDIT_SECONDS,
} from './credit-pricing';
import {
  clearRetry,
  describe,
  headroom,
  newConnection,
  refusal,
  remaining,
  track,
  type ConnectionCredit,
  type CreditAdmission,
  type CreditStopReason,
  type SettleJob,
} from './meter-connection';
import { MeterLeaseSync } from './meter-lease-sync';
import {
  EXTEND_HEADROOM_AUDIO_SECONDS,
  MeterRunningChecks,
} from './meter-running-checks';
import { UserLedgerGate } from './user-ledger-gate';

export {
  MESSAGES,
  type CreditAdmission,
  type CreditStopReason,
} from './meter-connection';
export {
  EXTEND_HEADROOM_AUDIO_SECONDS,
  EXTEND_RETRY_DELAYS_MS,
  EXTEND_RETRY_STEADY_MS,
} from './meter-running-checks';

// Meters /ws/translate against the credit ledger.
//
// A conversation is many short turns on one socket, so the lease is per
// CONNECTION: opened by the first admitted start, extended as audio arrives,
// settled turn by turn, closed when the socket goes. Every amount below is
// credit-seconds: accepted audio seconds × the turn's multiplier.
//
// Two outage rules, on purpose different. A start that needs the ledger and
// cannot reach it is refused (`credits_unavailable`): nothing new begins
// unmetered. A running connection whose extend fails carries on for at most
// one more lease (see `MeterRunningChecks`).

/**
 * Ledger transactions one account may have at once from this meter; the rest
 * queue in memory. Its writes serialise on the user's lock anyway, so a second
 * slot only lets a settle overlap an extend.
 */
export const MAX_LEDGER_CALLS_PER_USER = 2;
/**
 * Starts one account may have waiting on the ledger at once. An account can
 * hold three turns, so more starts than that in flight can only be churn (many
 * sockets looping `start`); they are refused without touching the database.
 */
export const MAX_ADMITS_IN_FLIGHT_PER_USER = 3;

@Injectable()
export class TranslationMeter {
  private readonly logger = new Logger(TranslationMeter.name);
  /** Keyed weakly by socket: the state lives exactly as long as the connection. */
  private readonly connections = new WeakMap<StreamSocket, ConnectionCredit>();
  /**
   * The one process-wide index: which socket a turn belongs to, because a turn
   * end arrives by session id alone. Entries leave in `turnEnded` and `detach`.
   */
  private readonly turnSockets = new Map<string, StreamSocket>();
  /** Starts per user currently waiting on the ledger; entries leave at zero. */
  private readonly admitsInFlight = new Map<string, number>();
  private readonly sync: MeterLeaseSync;
  private readonly running: MeterRunningChecks;

  constructor(@Inject(CREDIT_LEDGER) ledger: CreditLedgerPort) {
    this.sync = new MeterLeaseSync(
      ledger,
      new UserLedgerGate(MAX_LEDGER_CALLS_PER_USER),
    );
    this.running = new MeterRunningChecks(this.sync);
  }

  /** Turns being metered right now, process-wide. */
  get trackedTurns(): number {
    return this.turnSockets.size;
  }

  /** A verified socket connected; `onStop` ends its turns when credit runs out. */
  attach(
    socket: StreamSocket,
    userId: string,
    onStop: (reason: CreditStopReason) => void,
  ): void {
    this.connections.set(socket, newConnection(userId, onStop));
  }

  /**
   * Whether a turn priced at `multiplier` may start. Opens the connection's
   * lease on its first start; otherwise reaches the ledger only when the lease
   * is nearly spent, so most starts cost no database round trip.
   */
  async admit(
    socket: StreamSocket,
    multiplier: number,
  ): Promise<CreditAdmission> {
    const conn = this.connections.get(socket);
    // A socket with no verified owner has no account to bill, so it gets nothing.
    if (!conn || conn.detached) return refusal('credits_exhausted', 0);
    const needsLedger =
      !conn.leaseId ||
      headroom(conn) <
        Math.max(
          START_MIN_CREDIT_SECONDS,
          EXTEND_HEADROOM_AUDIO_SECONDS * multiplier,
        );
    if (needsLedger) {
      const inFlight = this.admitsInFlight.get(conn.userId) ?? 0;
      if (inFlight >= MAX_ADMITS_IN_FLIGHT_PER_USER) {
        return refusal('credits_unavailable', 0);
      }
      this.admitsInFlight.set(conn.userId, inFlight + 1);
      const want = LEASE_AUDIO_SECONDS * multiplier;
      try {
        await track(
          conn,
          conn.leaseId
            ? this.sync.extend(conn, want)
            : this.sync.reopen(conn, undefined, want),
        );
      } catch (err) {
        this.logger.warn(
          `admit for user ${conn.userId} could not reach the ledger: ${describe(err)}`,
        );
        return refusal('credits_unavailable', 0);
      } finally {
        const left = (this.admitsInFlight.get(conn.userId) ?? 1) - 1;
        if (left > 0) this.admitsInFlight.set(conn.userId, left);
        else this.admitsInFlight.delete(conn.userId);
      }
    }
    if (conn.detached) return refusal('credits_exhausted', 0);
    const left = remaining(conn);
    if (left < START_MIN_CREDIT_SECONDS) {
      return refusal('credits_exhausted', left);
    }
    conn.exhausted = false;
    this.running.warnIfLow(socket, conn);
    return { admitted: true };
  }

  /** An admitted start opened turn `sessionId`; its audio is billed at `multiplier`. */
  turnOpened(
    socket: StreamSocket,
    sessionId: string,
    multiplier: number,
    conversationId?: string,
  ): void {
    const conn = this.connections.get(socket);
    if (!conn || conn.detached) return;
    conn.turns.set(sessionId, { audioSeconds: 0, multiplier, conversationId });
    this.turnSockets.set(sessionId, socket);
  }

  /** Count `acceptedSeconds` the turn accepted (0 for a refused frame counts nothing). */
  onFrame(
    socket: StreamSocket,
    sessionId: string,
    acceptedSeconds: number,
  ): void {
    if (!(acceptedSeconds > 0)) return;
    const conn = this.connections.get(socket);
    const turn = conn?.turns.get(sessionId);
    if (!conn || !turn) return;
    turn.audioSeconds += acceptedSeconds;
    this.running.check(socket, conn, turn.multiplier);
  }

  /**
   * Settle a turn that left the registry. Idempotent: the index entry and the
   * turn are removed before anything is awaited, so a second call is a no-op.
   * The whole credit-seconds of (this turn + the connection's carried
   * fraction) are settled; the fraction left over carries to the next turn.
   */
  turnEnded(sessionId: string): void {
    const socket = this.turnSockets.get(sessionId);
    if (!socket) return;
    this.turnSockets.delete(sessionId);
    const conn = this.connections.get(socket);
    const turn = conn?.turns.get(sessionId);
    if (!conn || !turn) return;
    conn.turns.delete(sessionId);
    const exact = turn.audioSeconds * turn.multiplier + conn.carry;
    // The epsilon keeps 2.4 + 0.6 from flooring to 2 on float error.
    const credits = Math.floor(exact + 1e-9);
    conn.carry = Math.max(0, exact - credits);
    conn.lastTurn = { sessionId, conversationId: turn.conversationId };
    this.settleInBackground(conn, {
      sessionId,
      conversationId: turn.conversationId,
      credits,
    });
  }

  /**
   * The socket is gone: settle what is left (the carried fraction rounded, on
   * the last turn), wait for every settle in flight, retry any that failed
   * once, then close the lease and give back the rest.
   */
  async detach(socket: StreamSocket): Promise<void> {
    const conn = this.connections.get(socket);
    if (!conn || conn.detached) return;
    conn.detached = true;
    clearRetry(conn);
    for (const sessionId of [...conn.turns.keys()]) this.turnEnded(sessionId);
    const rest = Math.round(conn.carry);
    conn.carry = 0;
    if (conn.lastTurn) {
      this.settleInBackground(conn, {
        ...conn.lastTurn,
        credits: rest,
        idempotencyKey: `settle:${conn.lastTurn.sessionId}:rest`,
      });
    }
    while (conn.pending.size > 0) await Promise.allSettled([...conn.pending]);
    for (const job of conn.failedSettles.splice(0)) {
      try {
        await this.sync.settleOnce(conn, job);
      } catch (err) {
        this.logger.warn(
          `settle settle:${job.sessionId} for user ${conn.userId} (${job.credits} credit-seconds) failed twice: ${describe(err)}`,
        );
      }
    }
    const leaseId = conn.leaseId;
    this.connections.delete(socket);
    if (!leaseId) return;
    await this.sync.close(conn, leaseId);
  }

  /** Settle `job` without blocking the caller; a failure is retried at detach. */
  private settleInBackground(conn: ConnectionCredit, job: SettleJob): void {
    if (job.credits <= 0) return;
    conn.settling += job.credits;
    const work = this.sync
      .settleOnce(conn, job)
      .catch((err: unknown) => {
        this.logger.warn(
          `settle settle:${job.sessionId} for user ${conn.userId} failed; retrying at disconnect: ${describe(err)}`,
        );
        conn.failedSettles.push(job);
      })
      .finally(() => {
        conn.settling -= job.credits;
      });
    void track(conn, work);
  }
}
