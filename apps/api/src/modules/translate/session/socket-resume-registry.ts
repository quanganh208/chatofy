/**
 * Which socket currently carries each resumable conversation, so a client that
 * reconnects after a drop can be joined back to the conversation it left.
 *
 * Why it exists: on 2026-11-11 a browser's socket died between the browser and
 * the Cloudflare edge, and the API never saw it close. The client's replacement
 * socket would have started a conversation with no past, and the dead socket's
 * open turns would have held the per-user turn ceiling until the idle sweep.
 *
 * A client names its conversation with a random `resume` key on the upgrade
 * URL. The key only means anything together with the verified user id, so one
 * user can never claim another's socket by guessing or replaying a key.
 *
 * Two shapes of drop meet here:
 *  - **The old socket is still open** (half-open, the 2026-11-11 case).
 *    `claim` returns it, and the caller adopts its state and ends it.
 *  - **The old socket already closed cleanly.** Its disconnect `release`d it
 *    into `parked` for `parkMs`, keeping its conversation history alive.
 *    `claim` returns it from there. If nobody claims it in time, `onExpired`
 *    lets the caller forget it.
 */
export class SocketResumeRegistry<S extends object> {
  /** `${userId}:${key}` → the socket that currently carries that conversation. */
  private readonly byKey = new Map<string, S>();
  private readonly keyOf = new WeakMap<S, string>();
  private readonly parked = new Map<
    string,
    { socket: S; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private readonly parkMs: number,
    private readonly onExpired: (socket: S) => void,
  ) {}

  /**
   * Make `socket` the carrier of `userId`'s conversation `key`, and return the
   * socket it replaces, if any.
   *
   * `parked: true` means the predecessor has already been disconnected and only
   * its conversation history is left. `false` means it is still open and the
   * caller has to end it.
   */
  claim(
    userId: string,
    key: string,
    socket: S,
  ): { previous: S; parked: boolean } | null {
    const slot = `${userId}:${key}`;
    this.keyOf.set(socket, slot);

    const waiting = this.parked.get(slot);
    if (waiting) {
      clearTimeout(waiting.timer);
      this.parked.delete(slot);
      this.byKey.set(slot, socket);
      return { previous: waiting.socket, parked: true };
    }

    const previous = this.byKey.get(slot);
    this.byKey.set(slot, socket);
    if (previous === undefined || previous === socket) return null;
    return { previous, parked: false };
  }

  /**
   * A socket went away. Returns whether its conversation was parked, in which
   * case the caller must keep the history and leave forgetting it to
   * `onExpired`.
   *
   * Only the socket that still carries its conversation is parked. One that
   * was already replaced has handed its history over, and is forgotten as
   * usual.
   */
  release(socket: S): boolean {
    const slot = this.keyOf.get(socket);
    if (slot === undefined || this.byKey.get(slot) !== socket) return false;
    this.byKey.delete(slot);
    const timer = setTimeout(() => {
      if (this.parked.get(slot)?.socket !== socket) return;
      this.parked.delete(slot);
      this.onExpired(socket);
    }, this.parkMs);
    timer.unref?.();
    this.parked.set(slot, { socket, timer });
    return true;
  }
}

/**
 * The `resume` key a client put on its upgrade URL, if it is one this server
 * accepts. Anything else, including a missing or malformed key, means "do not
 * resume", never an error: an older client sends none.
 */
export function resumeKeyFrom(req: unknown): string | undefined {
  const url = (req as { url?: unknown } | null)?.url;
  if (typeof url !== 'string') return undefined;
  let key: string | null;
  try {
    key = new URL(url, 'http://upgrade.invalid').searchParams.get('resume');
  } catch {
    return undefined;
  }
  return key !== null && /^[A-Za-z0-9-]{8,64}$/.test(key) ? key : undefined;
}
