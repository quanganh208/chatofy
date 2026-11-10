import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import { summarizeBalance } from './credit-balance';
import { LedgerUnavailableError } from './credit-ledger.port';
import { CreditsLedger } from './credits-ledger.service';
import {
  LEDGER_TX_MAX_WAIT_MS,
  LEDGER_TX_TIMEOUT_MS,
  isLedgerUnavailable,
  runLedgerTransaction,
} from './ledger-transaction';
import type { PlanCatalog } from './plan-catalog';

const now = new Date('2026-11-15T00:00:00Z');
const later = new Date('2026-11-30T17:00:00Z');

describe('runLedgerTransaction', () => {
  it('bounds the transaction, sets lock_timeout first, then takes the user lock', async () => {
    const calls: string[] = [];
    const tx = {
      $executeRawUnsafe: vi.fn(async (sql: string) => calls.push(sql)),
      $executeRaw: vi.fn(
        async (strings: TemplateStringsArray, ...values: unknown[]) =>
          calls.push(`${strings.join('?')} ${JSON.stringify(values)}`),
      ),
    };
    const $transaction = vi.fn(
      async (fn: (t: typeof tx) => Promise<unknown>, _opts: unknown) => fn(tx),
    );
    const result = await runLedgerTransaction(
      { $transaction } as never,
      'user-1',
      async () => 'done',
    );
    expect(result).toBe('done');
    expect($transaction.mock.calls[0]![1]).toEqual({
      maxWait: LEDGER_TX_MAX_WAIT_MS,
      timeout: LEDGER_TX_TIMEOUT_MS,
    });
    expect(calls[0]).toBe("SET LOCAL lock_timeout = '2s'");
    expect(calls[1]).toContain('pg_advisory_xact_lock(hashtext(');
    expect(calls[1]).toContain('"user-1"');
  });

  it.each([
    [
      'a transaction API timeout',
      { code: 'P2028', message: 'Transaction API error' },
    ],
    [
      'a lock_timeout nested in the adapter error',
      {
        code: 'P2010',
        meta: { driverAdapterError: { cause: { originalCode: '55P03' } } },
      },
    ],
    ['an unreachable database', { code: 'P1001' }],
  ])('turns %s into LedgerUnavailableError', async (_name, error) => {
    const $transaction = vi.fn(async () => {
      throw Object.assign(new Error('boom'), error);
    });
    await expect(
      runLedgerTransaction({ $transaction } as never, 'u', async () => 1),
    ).rejects.toBeInstanceOf(LedgerUnavailableError);
  });

  it('lets an ordinary query error through unchanged', async () => {
    const violation = Object.assign(new Error('violates check constraint'), {
      code: 'P2010',
      meta: { code: '23514' },
    });
    expect(isLedgerUnavailable(violation)).toBe(false);
    const $transaction = vi.fn(async () => {
      throw violation;
    });
    await expect(
      runLedgerTransaction({ $transaction } as never, 'u', async () => 1),
    ).rejects.toBe(violation);
  });
});

describe('summarizeBalance', () => {
  it('splits plan and top-up credits and adds a lease’s unspent holding back to its grants', () => {
    const balance = summarizeBalance(
      [
        { id: 'free', source: 'free', remaining: 3_000, expiresAt: later },
        { id: 'topup', source: 'topup', remaining: 15_000, expiresAt: null },
      ],
      [
        {
          held: 4_200,
          consumed: 600,
          reserves: [
            { entryId: 'r1', grantId: 'free', take: 4_200, createdAt: now },
          ],
        },
      ],
      now,
    );
    expect(balance).toEqual({
      available: 18_000,
      held: 3_600,
      planSeconds: 6_600,
      topupSeconds: 15_000,
      planResetsAt: later,
      plan: 'free',
      proSource: null,
    });
  });

  it('reports Pro and its source while a pass is live', () => {
    const balance = summarizeBalance(
      [{ id: 'pass', source: 'pass', remaining: 0, expiresAt: later }],
      [],
      now,
    );
    expect(balance.plan).toBe('pro');
    expect(balance.proSource).toBe('pass');
  });
});

describe('CreditsLedger argument checks', () => {
  const ledger = new CreditsLedger({} as PrismaService, {} as PlanCatalog);

  it.each([0, -60, 1.5])(
    'refuses a grant of %s credit-seconds before touching the database',
    async (amount) => {
      await expect(
        ledger.grant({
          userId: 'u',
          source: 'promo',
          amount,
          externalRef: 'x',
        }),
      ).rejects.toBeInstanceOf(RangeError);
    },
  );

  it('refuses a non-positive debit', async () => {
    await expect(
      ledger.debit({ userId: 'u', amount: 0, idempotencyKey: 'k' }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
