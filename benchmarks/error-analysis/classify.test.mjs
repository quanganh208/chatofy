// node --test benchmarks/error-analysis/classify.test.mjs
//
// Needs the package built: `pnpm --filter @chatofy/ai-providers build`, because
// classify.mjs loads the fold from dist/ rather than carrying its own copy. Two
// definitions of "the same word apart from its tone marks" would drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, tally } from './classify.mjs';

const row = (hypothesis, reference, source = '') => ({ source, hypothesis, reference });

test('identical output is not an error', () => {
  assert.equal(classify(row('I drive a VinFast', 'I drive a VinFast')), 'exact');
});

test('a tone-only difference is the hotword signal', () => {
  assert.equal(classify(row('Quang Ninh', 'Quảng Ninh')), 'tone-or-diacritic');
});

test('casing and punctuation alone are cosmetic', () => {
  assert.equal(classify(row('xin chào bạn', 'Xin chào, bạn!')), 'casing-punctuation');
});

test('an echoed source is a passthrough, not a bad translation', () => {
  // Judged against the SOURCE, which is what separates "did not translate" from
  // "translated badly" — the two call for completely different fixes.
  assert.equal(
    classify(row('tôi đi VinFast', 'I drive a VinFast', 'tôi đi VinFast')),
    'untranslated-passthrough',
  );
});

test('changed digits outrank a length difference', () => {
  assert.equal(classify(row('My order is 4518', 'My order is 4517')), 'number-mismatch');
});

test('matching digits do not trigger a number mismatch', () => {
  assert.equal(classify(row('Order 4517 please', 'My order is 4517')), 'lexical-or-semantic');
});

test('a completed fragment reads as invention', () => {
  // The failure mode the repair/completion split created: the reference stops
  // where the speaker stopped, and the output supplies an ending.
  assert.equal(
    classify(
      row(
        'I need to ask you about the contract we signed last week in the meeting',
        'I need to ask you about the',
      ),
    ),
    'invention',
  );
});

test('a truncated turn reads as truncation', () => {
  assert.equal(
    classify(row('I would like', 'I would like to book a table for two people tonight please')),
    'truncation',
  );
});

test('ordinary wording variance is not invention', () => {
  // The threshold has to sit above normal translation variance, or the category
  // fires on correct output and stops being read.
  assert.equal(
    classify(row('Could you please send that over to me', 'Can you send that over')),
    'lexical-or-semantic',
  );
});

test('length says nothing on a short reference, and is not asked', () => {
  // Four reference words against nine is a 2.25 ratio, which would read as
  // invention on any longer utterance. On four words it is not evidence, so the
  // row falls through to the category that admits it needs a human.
  assert.equal(
    classify(row('I would really like to book a table tonight', 'I want a table')),
    'lexical-or-semantic',
  );
});

test('a comma is never reported as a tone error', () => {
  // The ordering guard. Both differences vanish under the match-fold, so asking
  // the tonal question first would send someone to add a hotword for a comma.
  assert.equal(classify(row('Quảng Ninh!', 'Quảng Ninh')), 'casing-punctuation');
});

test('a row without a reference is refused, not guessed at', () => {
  assert.throws(() => classify({ hypothesis: 'x', reference: '' }), /needs a reference/);
});

test('tally separates automatic categories from hand-written labels', () => {
  const result = tally([
    row('Quang Ninh', 'Quảng Ninh'),
    row('Ha Noi', 'Hà Nội'),
    { ...row('I drive a car', 'I drive a VinFast'), label: 'proper-noun' },
    row('I drive a VinFast', 'I drive a VinFast'),
  ]);
  assert.equal(result.total, 4);
  assert.equal(result.byCategory['tone-or-diacritic'], 2);
  assert.equal(result.byCategory.exact, 1);
  assert.equal(result.byLabel['proper-noun'], 1);
});

test('tally counts unlabelled semantic rows so they cannot pass as a finding', () => {
  const result = tally([row('I drive a car', 'I drive a VinFast')]);
  assert.equal(result.unlabelled, 1);
});
