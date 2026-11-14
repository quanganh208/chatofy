import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { CallCounter, geminiDecisionAsker, loadKey, renderState } from './decision-providers.mjs';

const realFetch = globalThis.fetch;
const realTimeout = globalThis.setTimeout;
beforeEach(() => {
  // Back-off waits run instantly; the order of attempts is what is tested.
  globalThis.setTimeout = (fn) => realTimeout(fn, 0);
});
afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.setTimeout = realTimeout;
});

const OK = { answers: { q: { type: 'noul', noul: 0.9 } }, usage: {} };

/** A fetch stub answering from a queue (a status, 'throw', or [status, body]); records keys used. */
function stubFetch(queue) {
  const keysUsed = [];
  globalThis.fetch = async (_url, init) => {
    keysUsed.push(init.headers['x-goog-api-key']);
    const next = queue.shift() ?? 200;
    if (next === 'throw') throw new Error('socket hang up');
    const [status, body] = Array.isArray(next) ? next : [next, next === 200 ? OK : {}];
    return { status, text: async () => JSON.stringify(body) };
  };
  return keysUsed;
}

const QUESTIONS = { q: { type: 'noul', instructions: 'x?' } };
const asker = (keys, counter = new CallCounter(50), log = () => {}) =>
  geminiDecisionAsker({ keys, counter, minGapMs: 0, log });

test('gemini rotates to the next key on a 429', async () => {
  const keysUsed = stubFetch([429, 200]);
  const out = await asker(['a', 'b'])('state', QUESTIONS);
  assert.equal(out.answers.q.noul, 0.9);
  assert.deepEqual(keysUsed, ['a', 'b']);
});

test('every key refused in a row: backs off, logs shared quota once, then retries', async () => {
  const keysUsed = stubFetch([429, 429, 200]);
  const logs = [];
  await asker(['a', 'b'], new CallCounter(50), (line) => logs.push(line))('state', QUESTIONS);
  assert.deepEqual(keysUsed, ['a', 'b', 'a']);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /same-project quota suspected/);
});

test('a dropped connection and a 502 are retried on the same key', async () => {
  const keysUsed = stubFetch(['throw', 502, 200]);
  const out = await asker(['a', 'b'])('state', QUESTIONS);
  assert.equal(out.answers.q.noul, 0.9);
  assert.deepEqual(keysUsed, ['a', 'a', 'a']);
});

test('one question set spends at most keys + 5 attempts, then gives up', async () => {
  const keysUsed = stubFetch(Array(20).fill(429));
  const counter = new CallCounter(50);
  await assert.rejects(asker(['a', 'b'], counter)('state', QUESTIONS), {
    code: 'HOST_UNAVAILABLE',
  });
  assert.equal(keysUsed.length, 7);
  assert.equal(counter.used, 7);
});

test('the call counter stops at its cap, and retries count toward it', async () => {
  stubFetch([429, 429, 429]);
  const counter = new CallCounter(2);
  await assert.rejects(asker(['a', 'b', 'c', 'd'], counter)('state', QUESTIONS), {
    code: 'CALL_CAP',
  });
  assert.equal(counter.used, 2);
});

test('a 200 without a usable answer is an error, not an answer', async () => {
  stubFetch([[200, { answers: {} }]]);
  await assert.rejects(asker(['a'])('state', QUESTIONS), /answer for q is missing/);
});

test('loadKey returns empty for a key that is absent everywhere', () => {
  const dir = mkdtempSync(join(tmpdir(), 'decision-env-'));
  const env = join(dir, 'env');
  writeFileSync(env, 'OTHER=1\nPRESENT="v"\n');
  assert.equal(loadKey('DECISION_TEST_ABSENT_KEY', env), '');
  assert.equal(loadKey('PRESENT', env), 'v');
});

test('renderState is deterministic and numbers the context', () => {
  const state = { source: 's', translation: 't', context: [{ source: 'a', translation: 'b' }] };
  assert.equal(renderState(state), renderState(structuredClone(state)));
  assert.match(renderState(state), /1\. source: a \| translation: b/);
});
