/**
 * When a meeting speaker's translation is rebuilt after a session it did not
 * stop, and when it gives up for good.
 *
 * A dropped `/ws/translate` is worth a few retries: an API restart or a network
 * blip heals in seconds, and the call goes on meanwhile. What a retry cannot
 * change is not retried — a close that says "you may not", or a start that
 * failed before any socket existed (the microphone or the audio graph refused),
 * which would only fail the same way again, and on mobile re-ask a permission
 * the user just declined.
 */

/** Why a speaker's translation ended for good. The leg builds no further session after it. */
export type ConferenceLegEndReason =
  /** No access token to (re)build a session with. */
  | 'no_token'
  /** The translator closed the socket with a refusal: policy, auth, or translation disabled. */
  | 'refused'
  /** The socket kept dropping and the retry budget ran out. */
  | 'retries_exhausted'
  /** The session could not start before reaching the network, e.g. no microphone permission. */
  | 'start_failed';

/** Backoff before each rebuild of a session the leg did not stop (user decision: 3 tries). */
const RESTART_BACKOFF_MS = [1_000, 2_000, 4_000] as const;
/** A session live this long has proven the path works; its failure starts a fresh budget. */
const RETRY_BUDGET_RESET_MS = 60_000;

/** A close that says "you may not", which a retry cannot change. */
export const isRefusal = (code: number | null): boolean =>
  code === 1008 || (code !== null && code >= 4000 && code <= 4999);

/** What is known about a session that stopped without being asked to. */
export interface LegStopCause {
  /** The translate socket's close code; null when it was not closed by the server (yet). */
  closeCode: number | null;
  /** The session failed before it opened a socket: microphone or audio graph. */
  beforeSocket: boolean;
}

export interface LegRestartPolicyDeps {
  /** Build the next session. Called from a timer, never synchronously. */
  restart: () => void;
  log: (message: string) => void;
  now?: () => number;
}

export class LegRestartPolicy {
  private retries = 0;
  private liveSince = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: LegRestartPolicyDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  /** A new session is being built; it has not proven anything yet. */
  attempting(): void {
    this.liveSince = 0;
  }

  /** The session being built is up and running. */
  live(): void {
    this.liveSince = this.now();
  }

  /**
   * A session stopped without being asked to. Schedules a rebuild, or returns
   * why translation ends instead.
   */
  stopped(cause: LegStopCause): ConferenceLegEndReason | null {
    if (isRefusal(cause.closeCode)) {
      this.deps.log(`translator closed the connection (${cause.closeCode}); not reconnecting`);
      return 'refused';
    }
    if (cause.beforeSocket) {
      this.deps.log('translation could not start (microphone or audio); not retrying');
      return 'start_failed';
    }
    if (this.liveSince > 0 && this.now() - this.liveSince > RETRY_BUDGET_RESET_MS) {
      this.retries = 0;
    }
    return this.schedule();
  }

  /** Rebuild after the next backoff step, or report the budget spent. */
  schedule(): ConferenceLegEndReason | null {
    const delay = RESTART_BACKOFF_MS[this.retries];
    if (delay === undefined) {
      this.deps.log(`translation stopped after ${this.retries} reconnect attempts`);
      return 'retries_exhausted';
    }
    this.retries += 1;
    this.deps.log(`translation dropped; reconnecting in ${delay}ms (attempt ${this.retries})`);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.deps.restart();
    }, delay);
    return null;
  }

  /** Forget a pending rebuild. */
  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
