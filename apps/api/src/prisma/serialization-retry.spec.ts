import { describe, expect, it, vi } from 'vitest';
import {
  isRetryableConflict,
  pause,
  retryDelayMs,
} from './serialization-retry';

/**
 * The rule every retrying store shares, tested on the error shapes Postgres and
 * `@prisma/adapter-pg` actually produce.
 *
 * The doubles below are built from own-property dumps of the real errors rather
 * than from how they print, because the difference between the two is exactly
 * what a previous version of this predicate missed: the shape that carries the
 * code somewhere other than `err.code` looks identical in a log.
 */

/**
 * Aborted on a STATEMENT inside the transaction: Prisma's own error, with a
 * `code` and no cause at all.
 */
function statementConflict(): Error {
  return Object.assign(
    new Error('Transaction failed due to a write conflict'),
    {
      code: 'P2034',
    },
  );
}

/**
 * Aborted at COMMIT: `@prisma/adapter-pg` throws a `DriverAdapterError` that
 * carries no `code` whatever, and whose `cause` is a PLAIN OBJECT holding
 * `originalCode`.
 *
 * Both of those details are load-bearing for this double, and
 * {@link assertRealCommitShape} holds it to them — a cause written as an `Error`
 * with a `code` on it would pass a predicate that still has the original bug.
 */
function commitConflict(): Error {
  return Object.assign(new Error('TransactionWriteConflict'), {
    cause: {
      originalCode: '40001',
      originalMessage:
        'could not serialize access due to read/write dependencies among transactions',
      kind: 'TransactionWriteConflict',
    },
  });
}

function assertRealCommitShape(err: Error & { cause?: unknown }): void {
  expect(err).not.toHaveProperty('code');
  expect(err.cause).not.toBeInstanceOf(Error);
  expect(err.cause).not.toHaveProperty('code');
  expect(Object.getPrototypeOf(err.cause)).toBe(Object.prototype);
}

describe('isRetryableConflict', () => {
  it('matches a conflict Postgres reported on a statement', () => {
    expect(isRetryableConflict(statementConflict())).toBe(true);
  });

  it('matches a conflict the driver adapter wrapped at commit', () => {
    // The case the predicate used to miss. It reaches the caller with no `code`
    // of its own, so anything reading `err.code` alone reads it as permanent and
    // answers 500 to a conflict a retry resolves.
    const err = commitConflict();
    assertRealCommitShape(err);
    expect(isRetryableConflict(err)).toBe(true);
  });

  it('matches a deadlock', () => {
    const err = Object.assign(new Error('deadlock detected'), {
      cause: { originalCode: '40P01', kind: 'DeadlockDetected' },
    });
    expect(isRetryableConflict(err)).toBe(true);
  });

  it('refuses a unique violation', () => {
    // Not transient. Re-running the identical body hits the identical
    // constraint, so a retry spends more transactions and fails the same way.
    const err = Object.assign(new Error('unique constraint'), {
      code: 'P2002',
    });
    expect(isRetryableConflict(err)).toBe(false);
  });

  it('refuses a unique violation the driver adapter wrapped', () => {
    // The same permanent failure arriving in the other shape: walking the cause
    // chain must not turn "look in more places" into "retry more things".
    const err = Object.assign(new Error('UniqueConstraintViolation'), {
      cause: { originalCode: '23505', kind: 'UniqueConstraintViolation' },
    });
    expect(isRetryableConflict(err)).toBe(false);
  });

  it('refuses a transaction timeout', () => {
    // A 15s transaction that ran out of time will run out again; the fix is a
    // smaller payload or a longer budget, not another attempt.
    expect(
      isRetryableConflict(
        Object.assign(new Error('transaction timed out'), { code: 'P2028' }),
      ),
    ).toBe(false);
  });

  it('refuses an error carrying no code anywhere, and a missing error', () => {
    expect(isRetryableConflict(new Error('boom'))).toBe(false);
    expect(isRetryableConflict(null)).toBe(false);
    expect(isRetryableConflict(undefined)).toBe(false);
    expect(isRetryableConflict('40001')).toBe(false);
  });

  it('refuses a numeric code rather than coercing it', () => {
    // SQLSTATE is text. A number here means something else produced it, and
    // treating `40001` and 40001 as the same value would retry on a guess.
    const err = Object.assign(new Error('conflict'), { code: 40001 });
    expect(isRetryableConflict(err)).toBe(false);
  });

  it('stops walking a cause chain that points at itself', () => {
    // The bound is the whole reason a depth limit exists: without it this call
    // never returns and the request that made it hangs instead of failing.
    const looping: { cause?: unknown } = {};
    looping.cause = looping;
    expect(isRetryableConflict(looping)).toBe(false);
  });

  it('gives up before a chain long enough to hide the code', () => {
    // Four hops is headroom over the one hop observed, not a promise to search
    // forever — a code this deep is not the error this predicate is about.
    const buried = {
      cause: { cause: { cause: { cause: { code: 'P2034' } } } },
    };
    expect(isRetryableConflict(buried)).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('draws from a window that doubles per attempt and then stops at the ceiling', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      expect(retryDelayMs(1, 25)).toBe(2.5);
      expect(retryDelayMs(2, 25)).toBe(5);
      expect(retryDelayMs(3, 25)).toBe(10);
      // Capped: the window would be 40ms, and the caller's ceiling is what a
      // request in flight is willing to pay.
      expect(retryDelayMs(4, 25)).toBe(12.5);
      expect(retryDelayMs(9, 25)).toBe(12.5);
    } finally {
      random.mockRestore();
    }
  });

  it('spans the whole window rather than a fixed delay plus jitter', () => {
    // Two transactions that conflicted once are in step. A delay with a shared
    // floor keeps them in step; only a fully random draw pulls them apart.
    const random = vi.spyOn(Math, 'random');
    try {
      random.mockReturnValue(0);
      expect(retryDelayMs(3, 25)).toBe(0);
      random.mockReturnValue(1 - Number.EPSILON / 2);
      expect(retryDelayMs(3, 25)).toBeLessThan(20);
      expect(retryDelayMs(3, 25)).toBeGreaterThan(19.9);
    } finally {
      random.mockRestore();
    }
  });
});

describe('pause', () => {
  it('waits rather than resolving on the next tick', async () => {
    // A retry loop that awaits something already settled has no backoff at all,
    // which is the state this module was added to fix.
    vi.useFakeTimers();
    try {
      let settled = false;
      const waiting = pause(50).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(49);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await waiting;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
