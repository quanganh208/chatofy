import { describe, expect, it } from 'vitest';
import {
  allocate,
  distributeRelease,
  type SpendableGrant,
} from './credit-spend';

const at = (iso: string) => new Date(iso);

function grant(
  id: string,
  remaining: number,
  expiresAt: string | null,
  costBasis: number,
  createdAt = '2026-11-01T00:00:00Z',
): SpendableGrant {
  return {
    id,
    remaining,
    expiresAt: expiresAt ? at(expiresAt) : null,
    costBasis,
    createdAt: at(createdAt),
  };
}

describe('allocate', () => {
  it('spends Free, then Pro, then a never-expiring top-up', () => {
    const grants = [
      grant('topup', 15_000, null, 500),
      grant('pro', 36_000, '2026-12-20T00:00:00Z', 999),
      grant('free', 7_200, '2026-11-30T17:00:00Z', 0),
    ];
    expect(allocate(50_000, grants)).toEqual([
      { grantId: 'free', take: 7_200 },
      { grantId: 'pro', take: 36_000 },
      { grantId: 'topup', take: 6_800 },
    ]);
  });

  it('takes free before paid when expiry ties', () => {
    const grants = [
      grant('paid', 100, '2026-11-30T17:00:00Z', 999),
      grant('free', 100, '2026-11-30T17:00:00Z', 0),
    ];
    expect(allocate(150, grants)).toEqual([
      { grantId: 'free', take: 100 },
      { grantId: 'paid', take: 50 },
    ]);
  });

  it('is FIFO among grants that otherwise tie, then by id', () => {
    const grants = [
      grant('b-new', 100, null, 500, '2026-11-05T00:00:00Z'),
      grant('z-old', 100, null, 500, '2026-11-01T00:00:00Z'),
      grant('a-old', 100, null, 500, '2026-11-01T00:00:00Z'),
    ];
    expect(allocate(250, grants).map((a) => a.grantId)).toEqual([
      'a-old',
      'z-old',
      'b-new',
    ]);
  });

  it('never takes more than the grants hold, and skips empty ones', () => {
    const grants = [grant('empty', 0, null, 0), grant('some', 30, null, 0)];
    expect(allocate(100, grants)).toEqual([{ grantId: 'some', take: 30 }]);
    expect(allocate(0, grants)).toEqual([]);
  });

  it.each([-1, 0.5])('refuses amount %s', (amount) => {
    expect(() => allocate(amount, [])).toThrow(RangeError);
  });
});

describe('distributeRelease', () => {
  const reserves = [
    {
      entryId: 'r1',
      grantId: 'free',
      take: 60,
      createdAt: at('2026-11-01T00:00:00Z'),
    },
    {
      entryId: 'r2',
      grantId: 'topup',
      take: 40,
      createdAt: at('2026-11-01T00:01:00Z'),
    },
  ];

  it('gives back the newest reserve first', () => {
    expect(distributeRelease(70, reserves)).toEqual([
      { entryId: 'r2', grantId: 'topup', back: 40 },
      { entryId: 'r1', grantId: 'free', back: 30 },
    ]);
  });

  it('gives back nothing when the lease spent everything', () => {
    expect(distributeRelease(0, reserves)).toEqual([]);
  });
});
