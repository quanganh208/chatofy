/**
 * Runs each user's ledger calls at most `limit` at a time; the rest wait here,
 * in memory, holding no database connection.
 *
 * Every ledger write takes the user's advisory lock, so a user's transactions
 * run one after another in Postgres anyway — but each one WAITING on that lock
 * holds a pool connection while it waits. Without this gate, one account with
 * many sockets could park a transaction per socket on its own lock and take the
 * whole pool from everyone else. With it, an account holds at most `limit`
 * connections however many sockets it opens.
 */
export class UserLedgerGate {
  private readonly users = new Map<
    string,
    { running: number; queue: Array<() => void> }
  >();

  constructor(private readonly limit: number) {}

  async run<T>(userId: string, work: () => Promise<T>): Promise<T> {
    let slot = this.users.get(userId);
    if (!slot) {
      slot = { running: 0, queue: [] };
      this.users.set(userId, slot);
    }
    if (slot.running < this.limit) slot.running += 1;
    // The slot is handed over by the finishing call, so `running` stays put.
    else await new Promise<void>((resolve) => slot.queue.push(resolve));
    try {
      return await work();
    } finally {
      const next = slot.queue.shift();
      if (next) next();
      else {
        slot.running -= 1;
        if (slot.running === 0) this.users.delete(userId);
      }
    }
  }

  /** Users with a call running or queued; for tests and diagnostics. */
  get activeUsers(): number {
    return this.users.size;
  }
}
