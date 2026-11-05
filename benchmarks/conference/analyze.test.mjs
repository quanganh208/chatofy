import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isLost, percentile, summarize } from './analyze.mjs';

const turn = (overrides = {}) => ({
  speaker: 'speaker-0',
  readyMs: 100,
  endSentMs: 1000,
  finalMs: 1200,
  firstSubtitleMs: 600,
  listenerFinalMs: 1250,
  firstAudioMs: 2000,
  audioFrames: 10,
  audioFramesDelivered: 10,
  polishedMs: null,
  endReason: 'completed',
  ...overrides,
});

test('percentile uses the nearest rank', () => {
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(percentile([], 50), null);
});

test('a turn with no final is lost unless nothing was said', () => {
  assert.equal(isLost(turn({ finalMs: null, endReason: 'too_many_turns' })), true);
  assert.equal(isLost(turn({ finalMs: null, endReason: 'no_speech' })), false);
  assert.equal(isLost(turn()), false);
});

test('an undelivered final lowers delivery, and lags use their own clocks', () => {
  const { overall } = summarize([
    turn(),
    turn({ listenerFinalMs: null }),
    turn({ finalMs: null, endReason: null }),
  ]);
  assert.equal(overall.finals, 2);
  assert.equal(overall.lost, 1);
  assert.equal(overall.lossRate, 0.333);
  assert.equal(overall.finalDeliveryRate, 0.5);
  assert.equal(overall.subtitleLagP50, 500);
  assert.equal(overall.audioLagP50, 1000);
});

test('words go to the turn their midpoint falls in', async () => {
  const { sliceWords } = await import('./export-judge-rows.mjs');
  const words = [
    { start: 0, end: 100, text: 'a' },
    { start: 900, end: 1100, text: 'b' },
    { start: 5000, end: 5100, text: 'c' },
  ];
  assert.deepEqual(sliceWords(words, [0, 1000]), ['a', 'b c']);
  assert.deepEqual(
    sliceWords(words, [2000]),
    [null].map(() => 'c'),
  );
});

test('word error ignores case and punctuation, and skips a turn with no reference', async () => {
  const { wordErrorRate } = await import('./export-judge-rows.mjs');
  assert.equal(wordErrorRate([{ source: 'hello there', scribe_source: 'Hello, there!' }]), 0);
  assert.equal(wordErrorRate([{ source: 'hello', scribe_source: 'hello there' }]), 0.5);
  assert.equal(wordErrorRate([{ source: 'x', scribe_source: null, scribe_missing: true }]), null);
});
