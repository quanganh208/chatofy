import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { creditUsageListReadSchema } from '@chatofy/types';
import { creditAmountMessage, creditDate, creditSign } from './credit-amount.ts';
import { SETTINGS_USAGE_ROWS, buyActionFor, recentUsage } from './use-credit-balance.ts';

const entry = (index: number, kind: string = 'translate') => ({
  id: `entry-${index}`,
  at: '2026-11-09T10:00:00.000Z',
  kind,
  credits: -1.5,
  conversationId: null,
  label: 'Translation',
});

describe('recentUsage', () => {
  it('keeps the newest rows, in the order the API sent them', () => {
    const read = creditUsageListReadSchema.parse({
      entries: Array.from({ length: 20 }, (_, index) => entry(index)),
      nextCursor: 'more',
    });
    const rows = recentUsage(read);
    assert.equal(rows.length, SETTINGS_USAGE_ROWS);
    assert.equal(rows[0]?.id, 'entry-0');
    assert.equal(rows.at(-1)?.id, `entry-${SETTINGS_USAGE_ROWS - 1}`);
  });

  it('leaves out a usage kind this build does not know instead of failing the list', () => {
    const read = creditUsageListReadSchema.parse({
      entries: [entry(0), entry(1, 'a_kind_added_later'), entry(2, 'grant')],
      nextCursor: null,
    });
    assert.deepEqual(
      recentUsage(read).map((row) => row.id),
      ['entry-0', 'entry-2'],
    );
    assert.equal(read.dropped, 1);
  });

  it('is empty before the first read and for a non-positive limit', () => {
    assert.deepEqual(recentUsage(undefined), []);
    const read = creditUsageListReadSchema.parse({ entries: [entry(0)], nextCursor: null });
    assert.deepEqual(recentUsage(read, 0), []);
  });
});

describe('buyActionFor', () => {
  it('links to the web only for an account let in to checkout', () => {
    assert.equal(buyActionFor({ checkoutAllowed: true }), 'buy-on-web');
    assert.equal(buyActionFor({ checkoutAllowed: false }), 'checkout-closed');
  });
});

describe('credit amounts', () => {
  it('writes the singular by hand and drops the sign', () => {
    assert.deepEqual(creditAmountMessage(1), { key: 'common.billing.creditAmountOne' });
    assert.deepEqual(creditAmountMessage(-1), { key: 'common.billing.creditAmountOne' });
    assert.deepEqual(creditAmountMessage(2.5), {
      key: 'common.billing.creditAmount',
      vars: { credits: '2.5' },
    });
    assert.deepEqual(creditAmountMessage(36000), {
      key: 'common.billing.creditAmount',
      vars: { credits: '36,000' },
    });
    assert.deepEqual(creditAmountMessage(0), {
      key: 'common.billing.creditAmount',
      vars: { credits: '0' },
    });
  });

  it('leads a spend with a minus and a grant with a plus', () => {
    assert.equal(creditSign(-0.5), '−');
    assert.equal(creditSign(600), '+');
    assert.equal(creditSign(0), '');
  });

  it('formats a date and passes an unreadable one through', () => {
    assert.match(creditDate('2026-12-01T12:00:00.000Z'), /Dec \d{1,2}, 2026/);
    assert.equal(creditDate('not a date'), 'not a date');
  });
});
