import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  auc,
  directionRule,
  gateStats,
  locoThresholds,
  skipAtRecall,
  thresholdFor,
  wilson,
} from './decision-score.mjs';

test('wilson interval brackets the point estimate and matches a known value', () => {
  const [lo, hi] = wilson(18, 20);
  assert.ok(lo < 0.9 && hi > 0.9);
  assert.ok(Math.abs(lo - 0.699) < 0.005, `lower bound ${lo}`);
  assert.deepEqual(wilson(0, 0).map(Number.isNaN), [true, true]);
});

test('threshold keeps the target recall on the rows it was chosen on', () => {
  const rows = [0.9, 0.8, 0.7, 0.2].map((score) => ({ score, draftSeriousMt: true }));
  assert.equal(
    thresholdFor(rows, (r) => r.score, 0.75),
    0.7,
  );
  assert.equal(
    thresholdFor(rows, (r) => r.score, 1),
    0.2,
  );
});

test('leave-one-conversation-out never sees the held-out conversation', () => {
  const rows = [
    { conv: 'a', score: 0.9, draftSeriousMt: true },
    { conv: 'b', score: 0.4, draftSeriousMt: true },
    { conv: 'c', score: 0.1, draftSeriousMt: true },
  ];
  // Held out a: threshold from b and c at 95% recall is their lowest positive, 0.1.
  assert.deepEqual(
    locoThresholds(rows, (r) => r.score),
    [0.1, 0.1, 0.4],
  );
});

test('gate stats count misses, skip, serious-after and flips', () => {
  const rep = (a, b) =>
    new Map([
      [1, a],
      [2, b],
    ]);
  const rows = [
    {
      conv: 'a',
      score: 0.9,
      perRepeat: rep(0.9, 0.9),
      draftSeriousMt: true,
      polishedSeriousMt: false,
      draftSeriousAny: true,
    },
    {
      conv: 'b',
      score: 0.8,
      perRepeat: rep(0.8, 0.8),
      draftSeriousMt: true,
      polishedSeriousMt: false,
      draftSeriousAny: true,
    },
    {
      conv: 'c',
      score: 0.1,
      perRepeat: rep(0.05, 0.85),
      draftSeriousMt: false,
      polishedSeriousMt: false,
      draftSeriousAny: false,
    },
    {
      conv: 'c',
      score: 0.05,
      perRepeat: rep(0.05, 0.05),
      draftSeriousMt: false,
      polishedSeriousMt: false,
      draftSeriousAny: false,
    },
  ];
  const s = gateStats(rows, { repeats: 2 });
  // Held out b, the threshold comes from a's lone positive (0.9), so b's 0.8 is
  // missed: one positive per conversation is exactly what LOCO punishes.
  assert.equal(s.positives, 2);
  assert.equal(s.misses, 1);
  assert.equal(s.skip, 0.75);
  assert.equal(s.seriousAfter, 0.25, 'the missed draft keeps its serious error');
  assert.equal(s.flips, 0.25, 'the third turn crosses its threshold (0.8) on one repeat only');
  assert.equal(s.auc, 1);
});

test('direction rule and skip at equal recall', () => {
  const rows = [
    { direction: 'vi_to_en', draftSeriousMt: true, score: 0.9 },
    { direction: 'vi_to_en', draftSeriousMt: false, score: 0.1 },
    { direction: 'en_to_vi', draftSeriousMt: false, score: 0.2 },
  ];
  assert.deepEqual(directionRule(rows), { misses: 0, recall: 1, skip: 1 / 3 });
  assert.equal(skipAtRecall(rows, 1), 2 / 3);
  assert.equal(
    auc(rows, (r) => r.score),
    1,
  );
});
