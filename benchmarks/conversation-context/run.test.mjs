import assert from 'node:assert/strict';
import { test } from 'node:test';

import { corpusProblems } from './corpus.mjs';
import { suggestTerms } from './export-turns.mjs';
import { contextFor, oracleHints } from './run.mjs';

// The word count the prompt builder uses, close enough for Latin-script fixtures.
const words = (text) =>
  text
    .trim()
    .split(/[\s\p{P}]+/u)
    .filter(Boolean).length;

const turn = (pos, source, terms = [], direction = 'vi_to_en') => ({
  conv: 'c',
  pos,
  direction,
  source,
  terms,
});

test('a term is offered only once an earlier turn said it and this turn says it', () => {
  const vinfast = { source: 'VinFast', target: 'VinFast', mustMatch: 'VinFast' };
  const first = turn(1, 'Tôi mua xe VinFast hôm qua', [vinfast]);
  const later = turn(2, 'Xe VinFast chạy rất êm và tiết kiệm');
  const unrelated = turn(3, 'Hôm nay trời mưa to quá đi mất');
  assert.equal(oracleHints(first, [], 'xe điện', words), undefined);
  assert.deepEqual(oracleHints(later, [first], 'xe điện', words), {
    glossary: [{ vi: 'VinFast', en: 'VinFast' }],
  });
  assert.equal(oracleHints(unrelated, [first, later], 'xe điện', words), undefined);
});

test('the topic reaches only a fragment, never a complete sentence', () => {
  assert.deepEqual(oracleHints(turn(2, 'Đúng rồi'), [turn(1, 'Xin chào')], 'xe điện', words), {
    topic: 'xe điện',
  });
  assert.equal(
    oracleHints(turn(2, 'Đánh một cái seri lớn ở đấy'), [], 'xe điện', words),
    undefined,
  );
});

test('a term longer than four words on either side is not offered', () => {
  const long = { source: 'Công ty Cổ phần Ô tô VinFast', target: 'VinFast', mustMatch: 'VinFast' };
  const earlier = turn(1, 'Công ty Cổ phần Ô tô VinFast thông báo', [long]);
  assert.equal(
    oracleHints(turn(2, 'Công ty Cổ phần Ô tô VinFast lại nói vậy'), [earlier], null, words),
    undefined,
  );
});

test('context is the last four earlier utterances in the same language', () => {
  const earlier = [1, 2, 3, 4, 5]
    .map((n) => turn(n, `vi ${n}`))
    .concat(turn(6, 'en 6', [], 'en_to_vi'));
  assert.deepEqual(contextFor(turn(7, 'now'), earlier), ['vi 2', 'vi 3', 'vi 4', 'vi 5']);
});

test('suggested terms are capitalised runs an earlier turn already said', () => {
  assert.deepEqual(suggestTerms('Hôm nay anh Minh Tuấn gặp Lan', ['anh minh tuan den roi']), [
    'Minh Tuấn',
  ]);
  assert.deepEqual(suggestTerms('Okay. Mình đi. I think I am', ['minh i think']), []);
});

test('an unfinished corpus is refused with every reason', () => {
  const problems = corpusProblems(
    [
      { ...turn(1, 'x', [{ source: 'A', mustMatch: null, target: null }]), reference: null },
      { ...turn(2, 'y'), reference: 'y', control: 'anchoring' },
    ],
    [{ conv: 'c', domain: null }],
    { needDomain: true },
  );
  assert.equal(problems.length, 5);
});

test('a terms-only corpus needs no reference but still needs finished terms', () => {
  const problems = corpusProblems(
    [
      { ...turn(1, 'x', [{ source: 'A', mustMatch: 'A', target: 'A' }]), reference: null },
      { ...turn(2, 'y', [{ source: 'B', mustMatch: null, target: 'B' }]), reference: null },
    ],
    [{ conv: 'c', domain: 'demo' }],
    { needDomain: true, needReference: false },
  );
  assert.deepEqual(problems, ['c#2: terms[0] (B) has no mustMatch; fill it or delete the term']);
});
