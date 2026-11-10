import { Logger } from '@nestjs/common';
import type { StreamSocket } from '../translate/session/stream-socket';
import {
  LEASE_AUDIO_SECONDS,
  LOW_BALANCE_CREDIT_SECONDS,
} from './credit-pricing';
import {
  clearRetry,
  describe,
  emit,
  headroom,
  leaseMayBeReaped,
  liveMultiplier,
  MESSAGES,
  remaining,
  track,
  type ConnectionCredit,
  type CreditStopReason,
} from './meter-connection';
import type { MeterLeaseSync } from './meter-lease-sync';

/** Extend once the lease has less than this many audio seconds of headroom left. */
export const EXTEND_HEADROOM_AUDIO_SECONDS = 30;
/** Retry delays for a failed mid-session extend, then every {@link EXTEND_RETRY_STEADY_MS}. */
export const EXTEND_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;
export const EXTEND_RETRY_STEADY_MS = 15_000;

/**
 * What a RUNNING connection does as its audio arrives: extend the lease ahead
 * of need, warn once when credit runs low, and stop the turns when it is gone.
 *
 * The outage rule lives here: an extend that throws mid-session grants one
 * virtual lease (fail open, bounded) and is retried with backoff; the
 * connection is ended with `credits_unavailable` only once that is spent too.
 */
export class MeterRunningChecks {
  private readonly logger = new Logger('TranslationMeter');

  constructor(private readonly sync: MeterLeaseSync) {}

  /** Decide, after new audio, whether to extend, warn, or stop. */
  check(
    socket: StreamSocket,
    conn: ConnectionCredit,
    multiplier: number,
  ): void {
    if (conn.exhausted || conn.detached) return;
    this.warnIfLow(socket, conn);
    const room = headroom(conn);
    const extending = conn.extending !== undefined;
    if (room <= 0) {
      if (conn.outage) return this.exhaust(socket, conn, 'credits_unavailable');
      if (conn.starved && !extending) {
        return this.exhaust(socket, conn, 'credits_exhausted');
      }
    }
    // A lease the reaper may have taken is confirmed with the ledger even when
    // the mirror shows room (or showed none to give): the room may be gone.
    const stale = leaseMayBeReaped(conn);
    if (
      (stale || room < EXTEND_HEADROOM_AUDIO_SECONDS * multiplier) &&
      !extending &&
      (stale || !conn.starved) &&
      !conn.outage
    ) {
      void track(
        conn,
        this.extendInBackground(socket, conn, LEASE_AUDIO_SECONDS * multiplier),
      );
    }
  }

  /** Warn the client once when what is left drops to the low-balance mark. */
  warnIfLow(socket: StreamSocket, conn: ConnectionCredit): void {
    if (conn.warned) return;
    const left = remaining(conn);
    if (left > LOW_BALANCE_CREDIT_SECONDS) return;
    conn.warned = true;
    emit(socket, this.logger, {
      type: 'server.error',
      code: 'credits_low',
      message: 'Your credits are running low',
      remainingCreditSeconds: left,
    });
  }

  /** A mid-session extend: on failure, fail open for one lease and retry with backoff. */
  private async extendInBackground(
    socket: StreamSocket,
    conn: ConnectionCredit,
    want: number,
  ): Promise<void> {
    try {
      await this.sync.extend(conn, want);
    } catch (err) {
      if (conn.detached || conn.exhausted) return;
      if (!conn.outage) {
        this.logger.warn(
          `extend for user ${conn.userId} failed; carrying on for one lease: ${describe(err)}`,
        );
        conn.outage = true;
        conn.virtual = want;
      }
      this.scheduleRetry(socket, conn, want);
    }
    this.check(socket, conn, liveMultiplier(conn));
  }

  private scheduleRetry(
    socket: StreamSocket,
    conn: ConnectionCredit,
    want: number,
  ): void {
    const delay =
      EXTEND_RETRY_DELAYS_MS[conn.retryAttempt] ?? EXTEND_RETRY_STEADY_MS;
    conn.retryAttempt += 1;
    conn.retryTimer = setTimeout(() => {
      conn.retryTimer = undefined;
      if (conn.detached || conn.exhausted) return;
      void track(conn, this.extendInBackground(socket, conn, want));
    }, delay);
    conn.retryTimer.unref?.();
  }

  /** Stop the connection's turns: say why once, then end them through the session service. */
  private exhaust(
    socket: StreamSocket,
    conn: ConnectionCredit,
    reason: CreditStopReason,
  ): void {
    conn.exhausted = true;
    clearRetry(conn);
    emit(socket, this.logger, {
      type: 'server.error',
      code: reason,
      message: MESSAGES[reason],
      remainingCreditSeconds:
        reason === 'credits_exhausted' ? 0 : remaining(conn),
    });
    conn.onStop(reason);
  }
}
