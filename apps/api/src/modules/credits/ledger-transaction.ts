import type { Prisma, PrismaClient } from '@prisma/client';
import { LedgerUnavailableError } from './credit-ledger.port';

// Every ledger write runs here: one bounded transaction holding the user's
// advisory lock.
//
// The lock serialises everything that moves one user's credits — reserves,
// settles, releases, the reaper, a void — so their reasoning never depends on
// row-lock order, and two first-of-month reads cannot both create the Free
// grant. It is per user, so users never wait on each other.
//
// The bounds matter as much as the lock. Each waiter holds a pool connection
// for as long as it waits, so an unbounded burst on one user could take every
// connection the app has. `lock_timeout` caps the wait on the lock itself,
// `maxWait` caps the wait for a connection, and `timeout` caps the whole
// transaction; hitting any of them surfaces as `LedgerUnavailableError`.

/** How long a transaction may wait for a pool connection. */
export const LEDGER_TX_MAX_WAIT_MS = 2_000;
/** How long a whole ledger transaction may run. */
export const LEDGER_TX_TIMEOUT_MS = 5_000;
/** How long a transaction may wait for the user's lock (a Postgres interval). */
export const LEDGER_LOCK_TIMEOUT = '2s';

export type LedgerTx = Prisma.TransactionClient;
type TransactionHost = Pick<PrismaClient, '$transaction'>;

/** Takes the user's advisory lock; released when the transaction ends. */
export async function lockUser(tx: LedgerTx, userId: string): Promise<void> {
  // SET LOCAL first, so the lock wait itself is bounded. SET takes no bind
  // parameters, and the value is a constant, never input.
  await tx.$executeRawUnsafe(
    `SET LOCAL lock_timeout = '${LEDGER_LOCK_TIMEOUT}'`,
  );
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
}

/** Runs `fn` in a bounded transaction holding `userId`'s advisory lock. */
export function runLedgerTransaction<T>(
  prisma: TransactionHost,
  userId: string,
  fn: (tx: LedgerTx) => Promise<T>,
): Promise<T> {
  return runBounded(prisma, async (tx) => {
    await lockUser(tx, userId);
    return fn(tx);
  });
}

/**
 * Runs `fn` in a bounded transaction WITHOUT the user's lock, for reads that
 * must not queue behind (or hold up) the live meter. `isolationLevel` lets a
 * multi-query read see one snapshot; the bounds and the error mapping are the
 * same as a locked transaction's.
 */
export function runLedgerRead<T>(
  prisma: TransactionHost,
  fn: (tx: LedgerTx) => Promise<T>,
  isolationLevel?: Prisma.TransactionIsolationLevel,
): Promise<T> {
  return runBounded(prisma, fn, isolationLevel);
}

async function runBounded<T>(
  prisma: TransactionHost,
  fn: (tx: LedgerTx) => Promise<T>,
  isolationLevel?: Prisma.TransactionIsolationLevel,
): Promise<T> {
  try {
    return await prisma.$transaction(fn, {
      maxWait: LEDGER_TX_MAX_WAIT_MS,
      timeout: LEDGER_TX_TIMEOUT_MS,
      ...(isolationLevel ? { isolationLevel } : {}),
    });
  } catch (err) {
    if (err instanceof LedgerUnavailableError) throw err;
    if (isLedgerUnavailable(err))
      throw new LedgerUnavailableError({ cause: err });
    throw err;
  }
}

/**
 * Prisma codes for "the transaction could not run in time or at all": P2028 is
 * the transaction API's own failure (no connection within `maxWait`, or past
 * `timeout`), P2034 a deadlock or serialisation conflict, P1001/P1002/P1008/P1017
 * the database being unreachable or dropping the connection.
 */
const PRISMA_UNAVAILABLE = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2028',
  'P2034',
]);
/**
 * Postgres SQLSTATEs with the same meaning: 55P03 lock_not_available (the
 * `lock_timeout`), 57014 query_canceled, 40P01 deadlock_detected, 57P01
 * admin_shutdown, and the 08xxx connection exceptions.
 */
const PG_UNAVAILABLE = new Set([
  '55P03',
  '57014',
  '40P01',
  '57P01',
  '08000',
  '08003',
  '08006',
]);
const UNAVAILABLE_MESSAGE =
  /lock timeout|Transaction API error|Unable to start a transaction|Transaction already closed|transaction was expired|Connection terminated|ECONNREFUSED|timeout exceeded when trying to connect/i;

/**
 * Whether `err` means the ledger was unreachable rather than that a query was
 * wrong. The driver adapter nests the database's own error a few levels deep
 * (`cause`, `meta`, `meta.driverAdapterError`), so this walks those links.
 */
export function isLedgerUnavailable(err: unknown, depth = 0): boolean {
  if (depth > 6 || err === null || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  for (const key of ['code', 'originalCode', 'sqlState']) {
    const value = e[key];
    if (
      typeof value === 'string' &&
      (PRISMA_UNAVAILABLE.has(value) || PG_UNAVAILABLE.has(value))
    ) {
      return true;
    }
  }
  if (typeof e.message === 'string' && UNAVAILABLE_MESSAGE.test(e.message))
    return true;
  return ['cause', 'meta', 'driverAdapterError'].some((key) =>
    isLedgerUnavailable(e[key], depth + 1),
  );
}
