import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  editedOf,
  heldOutContext,
  heldOutVerdict,
  successorLimit,
  newLimit,
  oldLimit,
  regressionInput,
  regressionSplit,
  regressionVerdict,
  rejects,
  requestOf,
  restoresVerdict,
  runaways,
  runawaysVerdict,
} from './guard-bound.mjs';
import { wilson } from './wilson.mjs';

const longSource = 'A source sentence that runs on. '.repeat(4).trim(); // 131 chars
const shortDraft = 'A short draft.'; // 14 chars

test('en target, short draft, long source: the new rule accepts what the old rejects', () => {
  const req = { source: longSource, draft: shortDraft, sourceLanguage: 'vi', targetLanguage: 'en' };
  const answer = 'x'.repeat(150);
  assert.equal(rejects(answer, req, oldLimit), true);
  assert.equal(rejects(answer, req, newLimit), false);
  assert.equal(rejects('x'.repeat(2 * longSource.length + 41), req, newLimit), true);
});

test('zh target keeps the draft bound', () => {
  const req = {
    source: longSource,
    draft: '今天雨大。',
    sourceLanguage: 'vi',
    targetLanguage: 'zh',
  };
  assert.equal(newLimit(req), oldLimit(req));
  assert.equal(rejects('雨'.repeat(60), req, newLimit), true);
});

test('editedOf strips tags before measuring', () => {
  assert.equal(editedOf('  <draft>Hi</draft> <transcript>x</transcript> '), 'Hi x');
  const req = { source: 'ab', draft: 'ab', targetLanguage: 'en' };
  assert.equal(rejects(`<draft>${'y'.repeat(44)}</draft>`, req, newLimit), false);
});

const row = (i, context = 2, direction = 'en_to_vi') => ({
  id: `c${String(i).padStart(2, '0')}#${i}`,
  conv: `c${i}`,
  pos: i,
  direction,
  source: `source ${i} `.repeat(5),
  translation: `draft ${i}`,
  original: `full translation ${i} `.repeat(3),
  context: Array.from({ length: context }, (_, k) => ({
    source: `s${k}`,
    translation: `ctx ${k} `.repeat(8),
  })),
});

test('runaways are deterministic, use 10 + 10 distinct rows, and need enough context rows', () => {
  const rows = Array.from({ length: 25 }, (_, i) => row(i, i % 2 ? 4 : 1));
  const a = runaways(rows, (r) => r.original, 'shortDraft');
  const b = runaways([...rows].reverse(), (r) => r.original, 'shortDraft');
  assert.deepEqual(a, b);
  assert.equal(a.length, 20);
  assert.equal(new Set(a.map((r) => r.id)).size, 20);
  assert.ok(a.filter((r) => r.shape === 'context').every((r) => r.answerLength > 0));
  assert.throws(() =>
    runaways(
      rows.map((r) => ({ ...r, context: [] })),
      (r) => r.original,
      'x',
    ),
  );
});

test('the context runaway keeps only the polisher window of 3 turns', () => {
  const rows = Array.from({ length: 20 }, (_, i) => row(i, 4));
  const [first] = runaways(rows, (r) => r.translation, 'clean');
  const expected = 3 * 'ctx 0 '.repeat(8).length + rows[0].translation.length; // joined by spaces
  assert.ok(Math.abs(first.answerLength - expected) <= 4);
});

test('runawaysVerdict applies 19/20 per set', () => {
  const make = (set, over) =>
    Array.from({ length: 20 }, (_, i) => ({
      id: `${set}${i}`,
      set,
      shape: i < 10 ? 'context' : 'commentary',
      answerLength: i < over ? 200 : 50,
      oldLimit: 60,
      newLimit: 100,
    }));
  assert.equal(runawaysVerdict([...make('clean', 19), ...make('shortDraft', 20)]).pass, true);
  const miss = runawaysVerdict([...make('clean', 18), ...make('shortDraft', 20)]);
  assert.equal(miss.pass, false);
  assert.equal(miss.clean.acceptedIds.length, 2);
});

test('restoresVerdict counts guard-rejected raws the new rule accepts', () => {
  const base = { direction: 'vi_to_en', source: longSource, translation: shortDraft };
  const rows = [
    ...Array.from({ length: 10 }, () => ({ ...base, guardRejected: true, raw: 'y'.repeat(120) })),
    { ...base, guardRejected: false, raw: '' },
  ];
  const v = restoresVerdict(rows);
  assert.equal(v.total, 10);
  assert.equal(v.newAccepted, 10);
  assert.equal(v.oldAccepted, 0);
  assert.equal(v.rawAnswers, 10);
  assert.equal(v.pass, true);
});

test('regressionInput keeps the turns with a translation', () => {
  const turns = [row(1), row(2), { ...row(3), translation: '' }];
  assert.equal(regressionInput(turns).length, 2);
});

test('wilson brackets the estimate and is empty for no rows', () => {
  const [lo, hi] = wilson(18, 20);
  assert.ok(lo < 0.9 && hi > 0.9);
  assert.ok(Math.abs(lo - 0.699) < 0.005, `lower bound ${lo}`);
  assert.deepEqual(wilson(0, 0).map(Number.isNaN), [true, true]);
});

test('regressionSplit reads the draft from the input and applies the other checks', () => {
  const base = { conv: 'k', direction: 'vi_to_en', source: longSource, translation: shortDraft };
  const input = [1, 2, 3, 4].map((pos) => ({ ...base, pos }));
  const polished = [
    { ...input[0], translation: 'polished line', rewritten: true, raw: 'polished line' },
    { ...input[1], rewritten: false, raw: 'y'.repeat(120) }, // old rejects, new accepts
    { ...input[2], rewritten: false, raw: 'z'.repeat(400) }, // both reject
    { ...input[3], rewritten: false, raw: 'leak '.repeat(20) }, // finalize refuses
  ];
  const finalize = (req, edited) => (edited.startsWith('leak') ? null : edited);
  const { counts, diff } = regressionSplit(polished, input, finalize);
  assert.equal(counts.rewritten, 1);
  assert.equal(counts.oldRejected, 3);
  assert.equal(diff.length, 1);
  assert.equal(diff[0].id, 'k#2');
  assert.equal(diff[0].translation, 'y'.repeat(120));
});

test('regressionSplit: the new limit never falls below the old, even when the draft is longer', () => {
  const r = { conv: 'k', pos: 1, direction: 'vi_to_en', source: 'a', translation: 'b'.repeat(50) };
  assert.doesNotThrow(() => regressionSplit([{ ...r, raw: '' }], [r], () => null));
});

const answer = (...errors) => ({
  errors: errors.map(([origin, category, severity = 'major']) => ({ origin, category, severity })),
});

test('regressionVerdict counts only serious origin:category keys the draft lacks', () => {
  const diff = ['a#1', 'b#1', 'c#1'].map((id) => ({ id }));
  const draftAnswers = new Map([
    ['a#1', [answer(['mt', 'omission']), answer(['mt', 'omission']), answer()]],
    ['b#1', [answer(), answer(), answer()]],
    ['c#1', [answer(), answer(), answer()]],
  ]);
  const clean = (overrides = {}) =>
    new Map([
      ['a#1', [answer(['mt', 'omission']), answer(['mt', 'omission']), answer()]],
      ['b#1', [answer(['mt', 'accuracy', 'minor']), answer(), answer()]],
      ['c#1', [answer(), answer(), answer()]],
      ...Object.entries(overrides),
    ]);
  const ok = regressionVerdict(diff, { draftAnswers, diffAnswers: clean() });
  assert.equal(ok.introduced, 0);
  assert.equal(ok.status, 'pass');
  const bad = regressionVerdict(diff, {
    draftAnswers,
    diffAnswers: clean({
      'c#1': [answer(['mt', 'addition']), answer(['mt', 'addition']), answer()],
    }),
  });
  assert.equal(bad.introduced, 1);
  assert.equal(bad.status, 'stop');
});

test('regressionVerdict: 0–2 rows are inconclusive, still judged, and an error still stops', () => {
  const draftAnswers = new Map([['a#1', [answer(), answer(), answer()]]]);
  const diff = [{ id: 'a#1' }];
  assert.equal(
    regressionVerdict([], { draftAnswers, diffAnswers: new Map() }).status,
    'inconclusive',
  );
  const one = regressionVerdict(diff, {
    draftAnswers,
    diffAnswers: new Map([['a#1', [answer(), answer(), answer()]]]),
  });
  assert.equal(one.status, 'inconclusive');
  const broken = new Map([
    ['a#1', [answer(['mt', 'addition']), answer(['mt', 'addition']), answer()]],
  ]);
  assert.equal(regressionVerdict(diff, { draftAnswers, diffAnswers: broken }).status, 'stop');
  assert.throws(() => regressionVerdict(diff, { draftAnswers, diffAnswers: new Map() }));
});

test('requestOf reads languages from the direction', () => {
  const r = requestOf({ direction: 'vi_to_zh', source: 's', translation: 'd' });
  assert.deepEqual(r, { source: 's', draft: 'd', sourceLanguage: 'vi', targetLanguage: 'zh' });
});

test("the successor widens today's bound only up to 1.3 × source + 40, and never for zh", () => {
  const en = { source: 'x'.repeat(100), draft: 'y'.repeat(20), targetLanguage: 'en' };
  assert.equal(successorLimit(en), 170);
  const long = { ...en, draft: 'y'.repeat(100) };
  assert.equal(successorLimit(long), oldLimit(long));
  assert.equal(successorLimit({ ...en, targetLanguage: 'zh' }), oldLimit(en));
});

test('held-out context runaways skip the 10 rows the spent set used', () => {
  const rows = Array.from({ length: 23 }, (_, i) => row(i, 3));
  const held = heldOutContext(rows, (r) => r.translation, 'clean');
  assert.equal(held.length, 13);
  const spent = new Set(
    runaways(rows, (r) => r.translation, 'clean')
      .filter((r) => r.shape === 'context')
      .map((r) => r.id),
  );
  assert.ok(held.every((r) => !spent.has(r.id)));
});

test('held-out verdict: 0 admitted on clean, at most 1 on the short-draft set', () => {
  const r = (set, answerLength) => ({
    id: `${set}${answerLength}`,
    set,
    answerLength,
    oldLimit: 100,
    successorLimit: 150,
  });
  assert.equal(
    heldOutVerdict([r('clean', 200), r('shortDraft', 120), r('shortDraft', 90)]).pass,
    true,
  );
  assert.equal(heldOutVerdict([r('clean', 120), r('shortDraft', 200)]).pass, false);
  assert.equal(
    heldOutVerdict([r('clean', 200), r('shortDraft', 120), r('shortDraft', 130)]).pass,
    false,
  );
});
