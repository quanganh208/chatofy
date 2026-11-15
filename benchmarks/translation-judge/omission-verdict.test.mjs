import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  guardBound,
  heldOmission,
  outcomeOf,
  survivalRows,
  survivalSummary,
} from './omission-verdict.mjs';

const omit = { errors: [{ origin: 'mt', severity: 'major', category: 'omission' }] };
const minor = { errors: [{ origin: 'mt', severity: 'minor', category: 'omission' }] };
const clean = { errors: [] };

test('an omission is held only on a majority of serious answers', () => {
  assert.equal(heldOmission([omit, omit, clean]), true);
  assert.equal(heldOmission([omit, clean, clean]), false);
  assert.equal(heldOmission([omit, minor, minor]), false, 'minor does not count');
  assert.equal(heldOmission([]), false);
});

test('outcome separates a guard rejection from a decline and a failure', () => {
  assert.equal(outcomeOf({ rewritten: true }), 'rewritten');
  assert.equal(outcomeOf({ rewritten: false, failed: 'timeout' }), 'failed');
  assert.equal(outcomeOf({ rewritten: false, guardRejected: true }), 'guard-rejected');
  assert.equal(outcomeOf({ rewritten: false }), 'declined');
});

test('a guard-bound positive is one whose full translation the guard would refuse', () => {
  assert.equal(guardBound({ translation: 'a'.repeat(10), original: 'b'.repeat(61) }), true);
  assert.equal(guardBound({ translation: 'a'.repeat(10), original: 'b'.repeat(60) }), false);
});

test('survival: a standing draft survives, a rewrite survives only if the judge still holds it', () => {
  const row = (id, kind) => ({
    id,
    kind,
    conv: 'c',
    pos: id.length,
    translation: 'x',
    original: 'xy',
  });
  const positives = [
    row('a', 'trailing'),
    row('bb', 'trailing'),
    row('ccc', 'omission'),
    row('dddd', 'omission'),
  ];
  const draftAnswers = new Map([
    ['a', [omit, omit, omit]],
    ['bb', [omit, omit, clean]],
    ['ccc', [omit, omit, omit]],
    ['dddd', [clean, clean, clean]],
  ]);
  const arms = new Map([
    ['a', { rewritten: true, ms: 100 }],
    ['bb', { rewritten: true, ms: 9000 }],
    ['ccc', { rewritten: false, guardRejected: true, ms: 100 }],
    ['dddd', { rewritten: false, ms: 100 }],
  ]);
  const polishedAnswers = new Map([
    ['a', [clean, clean, clean]],
    ['bb', [omit, omit, clean]],
  ]);
  const rows = survivalRows(positives, {
    draftAnswers,
    polishedAnswers,
    arms,
    blocks: new Set(['c#2']),
  });
  const s = survivalSummary(rows);
  assert.equal(s.confirmed, 3, 'dddd is not confirmed by the ruler');
  assert.equal(s.survived, 2, 'bb kept the omission; ccc was discarded by the guard');
  assert.equal(s.stop, true, '2 survivors is at the stop bar');
  assert.deepEqual(s.byKind, {
    trailing: { survived: 1, of: 2 },
    omission: { survived: 1, of: 1 },
  });
  assert.deepEqual(s.byBlock, { false: { survived: 1, of: 2 }, true: { survived: 1, of: 1 } });
  assert.equal(s.slow, 1);
  assert.deepEqual(s.outcomes, { rewritten: 2, 'guard-rejected': 1, declined: 1 });
});

test('survival refuses a positive that was never replayed', () => {
  assert.throws(
    () =>
      survivalRows([{ id: 'x', conv: 'c', pos: 1, translation: 'a', original: 'b' }], {
        draftAnswers: new Map(),
        polishedAnswers: new Map(),
        arms: new Map(),
        blocks: new Set(),
      }),
    /not replayed/,
  );
});

test('survival refuses an incomplete judgement and a failure that is not a timeout', () => {
  const positives = [
    { id: 'a', kind: 'trailing', conv: 'c', pos: 1, translation: 'x', original: 'xy' },
  ];
  const base = { polishedAnswers: new Map(), blocks: new Set() };
  assert.throws(
    () =>
      survivalRows(positives, {
        ...base,
        draftAnswers: new Map([['a', [omit, omit]]]),
        arms: new Map([['a', { rewritten: false }]]),
      }),
    /2\/3 draft answers/,
  );
  const draftAnswers = new Map([['a', [omit, omit, omit]]]);
  assert.throws(
    () =>
      survivalRows(positives, {
        ...base,
        draftAnswers,
        arms: new Map([['a', { failed: '429 Too Many Requests' }]]),
      }),
    /retry it/,
  );
  const [row] = survivalRows(positives, {
    ...base,
    draftAnswers,
    arms: new Map([['a', { failed: 'The operation was aborted due to timeout' }]]),
  });
  assert.equal(row.survived, true, 'a timed-out polish leaves the draft standing, as in prod');
});
