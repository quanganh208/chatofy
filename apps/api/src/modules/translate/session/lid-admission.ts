/**
 * How many sockets may identify languages at once, per user and per process.
 *
 * An identifying session costs the speech sidecar more than a declared one —
 * every partial and final runs the language identifier before its decode — and
 * the sidecar refuses (503) rather than queues once its lanes are full. Without
 * a cap, one account opening five tabs could hold every lane and turn other
 * people's declared turns into refusals. One identifying socket per user, and
 * no more in the process than the sidecar has lanes for.
 *
 * Over the cap is not an error: a two-way start runs declared one-way and says
 * so on `server.session.ready`; only an undeclared source, which has nothing to
 * fall back to, is refused.
 */
const MAX_LID_SOCKETS_PER_USER = 1;

/** The production sidecar's lanes per engine (`PROD_LOCAL_STT_CONCURRENCY`). */
const MAX_LID_SOCKETS = 4;

export class LidAdmission<Socket = string> {
  private readonly holders = new Map<Socket, string>();

  constructor(
    private readonly perUser = MAX_LID_SOCKETS_PER_USER,
    private readonly total = MAX_LID_SOCKETS,
  ) {}

  /**
   * Whether `socket` (owned by `userId`) may identify. A socket that already
   * holds a slot keeps it; a refused one holds nothing to release.
   */
  admit(socket: Socket, userId: string): boolean {
    if (this.holders.has(socket)) return true;
    if (this.holders.size >= this.total) return false;
    let mine = 0;
    for (const owner of this.holders.values()) if (owner === userId) mine += 1;
    if (mine >= this.perUser) return false;
    this.holders.set(socket, userId);
    return true;
  }

  /** Give the slot back; called when the socket closes. Unknown sockets are a no-op. */
  release(socket: Socket): void {
    this.holders.delete(socket);
  }

  get size(): number {
    return this.holders.size;
  }
}
