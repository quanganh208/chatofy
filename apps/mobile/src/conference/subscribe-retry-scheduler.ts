/**
 * When to ask the server again after a subscribe it could not fully serve.
 *
 * A subscribe reply carries `retryAfterMs` when the server skipped a track it
 * may get on a later try — a publisher's track not ready on the SFU yet, or a
 * transient Cloudflare failure. Nothing else would ask again: subscribes are
 * otherwise sent only on join and on `conference.media.published`.
 *
 * At most one retry is pending at a time, and at most
 * {@link MAX_CONSECUTIVE_SUBSCRIBE_RETRIES} run back to back; a subscribe that
 * comes back with nothing skipped resets the count.
 */
export const MAX_CONSECUTIVE_SUBSCRIBE_RETRIES = 5;

export class SubscribeRetryScheduler {
  private readonly retry: () => void;
  private consecutive = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;

  /** `retry` queues one more subscribe; it runs when a scheduled delay ends. */
  constructor(retry: () => void) {
    this.retry = retry;
  }

  /** A subscribe round finished with this `retryAfterMs` (absent: nothing skipped). */
  completed(retryAfterMs: number | undefined): void {
    if (this.cancelled) return;
    if (retryAfterMs === undefined) {
      this.consecutive = 0;
      return;
    }
    if (this.timer !== null || this.consecutive >= MAX_CONSECUTIVE_SUBSCRIBE_RETRIES) return;
    this.consecutive += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.cancelled) this.retry();
    }, retryAfterMs);
  }

  /** Drop a pending retry and schedule none from now on. Idempotent. */
  cancel(): void {
    this.cancelled = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
