// node --test benchmarks/error-analysis/term-rendering.test.mjs
//
// No package build needed: unlike `classify.mjs`, this file carries no copy of
// anything from `@chatofy/ai-providers` to drift out of step with — a
// `mustMatch` regex is the row's own claim, checked against a `hypothesis`
// already written by `translate-rows.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreRow, scoreRows } from './term-rendering.mjs';

const row = (overrides) => ({ id: 'r1', hypothesis: '', mustMatch: '', ...overrides });

test('a hypothesis containing the required term passes', () => {
  const result = scoreRow(
    row({ hypothesis: 'The AI companies are racing', mustMatch: '\\bAI\\b' }),
  );
  assert.equal(result.pass, true);
});

test('a hypothesis missing the required term fails', () => {
  const result = scoreRow(
    row({ hypothesis: 'Who are the companies racing', mustMatch: '\\bAI\\b' }),
  );
  assert.equal(result.pass, false);
});

test('mustMatch is case-sensitive by default, so "ai" does not satisfy "AI"', () => {
  // The one distinction half these rows exist to make: lowercase ASR "ai" is
  // not the rendering being asked for, "AI" is.
  const result = scoreRow(row({ hypothesis: 'compete with ai companies', mustMatch: '\\bAI\\b' }));
  assert.equal(result.pass, false);
});

test('a case-insensitive claim is written into the pattern, not a flag', () => {
  const result = scoreRow(
    row({ hypothesis: 'Who are you', mustMatch: '\\b(?:Who|who) (?:are|is)\\b' }),
  );
  assert.equal(result.pass, true);
});

test('mustNotMatch fails a row even when mustMatch also passes', () => {
  // The shape an over-applied note produces: the sentence still contains a
  // "who" word somewhere, but the hypothesis also carries the wrong reading.
  const result = scoreRow(
    row({
      hypothesis: 'Are you an AI, who are you really',
      mustMatch: '\\bwho\\b',
      mustNotMatch: '\\bAI\\b',
    }),
  );
  assert.equal(result.pass, false);
});

test('mustNotMatch absent never fails a row on its own', () => {
  const result = scoreRow(row({ hypothesis: 'Who are you', mustMatch: '\\bWho\\b' }));
  assert.equal(result.pass, true);
});

test('a row with no mustMatch is refused, not silently skipped', () => {
  assert.throws(() => scoreRow({ id: 'r2', hypothesis: 'x' }), /carries no mustMatch/);
});

test('scoreRows totals passes and failures across a set of rows', () => {
  const result = scoreRows([
    row({ id: 'a', hypothesis: 'The AI market', mustMatch: '\\bAI\\b' }),
    row({ id: 'b', hypothesis: 'Who are you', mustMatch: '\\bAI\\b' }),
    row({ id: 'c', hypothesis: 'Who are you', mustMatch: '\\bWho\\b' }),
  ]);
  assert.equal(result.total, 3);
  assert.equal(result.passed, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].id, 'b');
});

test('an unmarked hypothesis (empty string) never matches a non-empty mustMatch', () => {
  const result = scoreRow(row({ hypothesis: '', mustMatch: '\\bAI\\b' }));
  assert.equal(result.pass, false);
});
