import assert from 'node:assert/strict';
import { test } from 'node:test';

import { captureFetch, guardRejects, parseArgs, replayId } from './review-arms.mjs';

const answer = (content) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    headers: { 'content-type': 'application/json' },
  });

test('capture keeps the answer while the caller still reads the untouched body', async () => {
  const capture = captureFetch('https://host/v1', async () => answer('edited line'));
  const response = await capture.fetch('https://host/v1/chat/completions', { method: 'POST' });
  assert.equal((await response.json()).choices[0].message.content, 'edited line');
  assert.equal(capture.take(), 'edited line');
  assert.equal(capture.take(), null, 'take clears the slot');
});

test('capture ignores other hosts and passes the request through unchanged', async () => {
  let seen;
  const capture = captureFetch('https://host/v1', async (input, init) => {
    seen = { input, init };
    return answer('x');
  });
  const init = { method: 'POST', body: '{"a":1}' };
  await capture.fetch('https://other/v1', init);
  assert.equal(capture.take(), null);
  assert.equal(seen.init, init, 'the same init object goes out');
});

test('the guard check mirrors the polisher: 2 × draft + 40 characters after tags', () => {
  const draft = 'a'.repeat(10);
  assert.equal(guardRejects('b'.repeat(60), draft), false);
  assert.equal(guardRejects('b'.repeat(61), draft), true);
  assert.equal(guardRejects(`<draft>${'b'.repeat(60)}</draft>`, draft), false);
});

test('perturbed rows resume by their own id, others by conv#pos', () => {
  assert.equal(replayId({ id: 'c#3~omission', conv: 'c', pos: 3 }), 'c#3~omission');
  assert.equal(replayId({ conv: 'c', pos: 3 }), 'c#3');
});

test('capture-raw refuses more than one call in flight', () => {
  assert.throws(() => parseArgs(['--arm', '2', '--capture-raw']), /--concurrency 1/);
  assert.equal(parseArgs(['--arm', '2', '--capture-raw', '--concurrency', '1']).captureRaw, true);
});
