import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  anchoringFlips,
  bootstrap,
  pairedDeltas,
  perRowMean,
  termAccuracy,
  termShare,
  verdict,
} from './score.mjs';

const row = (pos, bucket, hypothesis, extra = {}) => ({
  conv: 'c1',
  pos,
  bucket,
  hypothesis,
  error: null,
  terms: [{ source: 'VinFast', target: 'VinFast', mustMatch: 'VinFast' }],
  ...extra,
});

const baseline = [
  row(1, '1-5', 'VinFast cars'),
  row(2, '1-5', 'Vin fast cars'),
  row(20, '16+', 'VinFast again'),
  row(21, '16+', 'vinfast again'),
];
const arm = [
  row(1, '1-5', 'VinFast cars'),
  row(2, '1-5', 'Vin fast cars'),
  row(20, '16+', 'VinFast again'),
  row(21, '16+', 'VinFast again'),
];

test('an arm that fixes one of four terms gains 0.25', () => {
  const base = termAccuracy([baseline]);
  const fixed = termAccuracy([arm]);
  assert.equal(fixed.all - base.all, 0.25);
});

test('the gain lands in the bucket of the turn it fixed', () => {
  const base = termAccuracy([baseline]);
  const fixed = termAccuracy([arm]);
  assert.equal(fixed['1-5'] - base['1-5'], 0);
  assert.equal(fixed['16+'] - base['16+'], 0.5);
  assert.equal(fixed['6-15'], null);
});

test('a failed call scores its terms as missed, not as rendered', () => {
  assert.equal(termShare(row(1, '1-5', 'VinFast', { error: 'timeout' })), 0);
  assert.equal(termShare({ ...row(1, '1-5', 'x'), terms: [] }), null);
});

test('repeats are averaged per turn before pairing', () => {
  const second = arm.map((r) => ({ ...r, hypothesis: 'nothing' }));
  const mean = perRowMean([arm, second], termShare);
  assert.equal(mean.get('c1#1').value, 0.5);
  const deltas = pairedDeltas(perRowMean([baseline], termShare), perRowMean([arm], termShare));
  assert.deepEqual(deltas, [0, 0, 0, 1]);
});

test('the bootstrap is reproducible and brackets its mean', () => {
  const deltas = [0, 0, 0, 1, 0.5, 0, 1, 0];
  const a = bootstrap(deltas, { seed: 7 });
  assert.deepEqual(a, bootstrap(deltas, { seed: 7 }));
  assert.ok(a.low <= a.mean && a.mean <= a.high);
  assert.equal(bootstrap([]).n, 0);
});

test('an anchoring control flips when the wrong sense appears', () => {
  const control = (hypothesis) => ({
    ...row(5, '1-5', hypothesis),
    control: 'anchoring',
    mustNotMatch: '\\b[Pp]lay\\b',
  });
  assert.deepEqual(
    anchoringFlips([[control('Play a big series'), control('Build a large series')]]),
    {
      flips: 1,
      total: 2,
    },
  );
});

test('GO needs a real gain, later turns gaining at least as much, and no extra flips', () => {
  const real = { n: 10, mean: 0.2, low: 0.05, high: 0.3 };
  assert.equal(
    verdict({ termCi: real, gainLate: 0.3, gainEarly: 0.1, flipsArm: 0, flipsBase: 0 }),
    'GO',
  );
  assert.equal(
    verdict({
      termCi: { ...real, low: -0.01 },
      gainLate: 0.3,
      gainEarly: 0.1,
      flipsArm: 0,
      flipsBase: 0,
    }),
    'NO-GO',
  );
  assert.equal(
    verdict({ termCi: real, gainLate: 0.05, gainEarly: 0.1, flipsArm: 0, flipsBase: 0 }),
    'NO-GO',
  );
  assert.equal(
    verdict({ termCi: real, gainLate: 0.3, gainEarly: 0.1, flipsArm: 0.2, flipsBase: 0.1 }),
    'NO-GO',
  );
  assert.equal(
    verdict({ termCi: real, gainLate: null, gainEarly: 0.1, flipsArm: 0, flipsBase: 0 }),
    'UNDECIDED',
  );
});
