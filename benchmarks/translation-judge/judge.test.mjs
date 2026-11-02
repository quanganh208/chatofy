// node --test benchmarks/translation-judge/*.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calibrate } from './calibrate.mjs';
import { answerLabel, consensus } from './consensus.mjs';
import { judgeMessage, parseAnswer } from './judge-prompt.mjs';
import { pendingCalls } from './judge.mjs';
import { KINDS, RULES, perturbRows, pickCandidates, wordError } from './perturb.mjs';
import { bootstrap, judgedTurns, stats, verdict } from './score.mjs';
import { judgeRows, mediaMs } from './export-conversations.mjs';
import { armRow, costOf, polishRequest } from './review-arms.mjs';
import { pairTurns, pairedBootstrap, pairedStats, percentile } from './compare.mjs';

const err = (origin, severity = 'major', category = 'mistranslation') => ({
  span: 'x',
  category,
  severity,
  origin,
  reason: 'r',
});
const ans = (...errors) => ({ errors });

test('a finding needs a majority of repeats', () => {
  const c = consensus([ans(err('mt')), ans(err('mt')), ans()]);
  assert.ok(c.keys.has('mt') && c.keys.has('any') && c.keys.has('mt:mistranslation'));
  assert.equal(consensus([ans(err('mt')), ans(), ans()]).keys.size, 0);
});

test('minor errors do not make a turn wrong unless asked for', () => {
  const answers = [ans(err('mt', 'minor')), ans(err('mt', 'minor')), ans()];
  assert.equal(consensus(answers).keys.has('any'), false);
  assert.equal(consensus(answers, { serious: false }).keys.has('any'), true);
});

test('agreement compares whole labels', () => {
  assert.equal(answerLabel(ans(err('mt'), err('asr'))), 'asr+mt');
  assert.equal(consensus([ans(err('mt')), ans(err('mt'), err('asr')), ans()]).agreed, false);
  assert.equal(consensus([ans(), ans(), ans(err('mt'))]).agreed, true);
});

test('the answer parser refuses values outside the schema', () => {
  assert.deepEqual(parseAnswer(JSON.stringify({ errors: [] })), { errors: [] });
  assert.throws(() => parseAnswer(JSON.stringify({ errors: [err('mt', 'huge')] })), /severity/);
  assert.throws(() => parseAnswer('{}'), /errors array/);
});

test('the judge message carries both hearings and never a reference translation', () => {
  const text = judgeMessage({
    direction: 'vi_to_en',
    source: 'phát CAS',
    scribe_source: 'podcast',
    translation: 'broadcast',
    context: [],
  });
  assert.match(text, /Vietnamese → English/);
  assert.match(text, /REFERENCE HEARD:\npodcast/);
  assert.match(text, /APP HEARD:\nphát CAS/);
  assert.match(
    judgeMessage({ direction: 'en_to_vi', source: 'a', translation: 'b', scribe_missing: true }),
    /not available/,
  );
});

test('a resumed run asks only what has no answer', () => {
  const rows = [{ id: 'a' }, { id: 'b' }];
  const calls = pendingCalls(rows, 2, new Set(['a@1', 'b@2']));
  assert.deepEqual(
    calls.map((c) => `${c.row.id}@${c.repeat}`),
    ['a@2', 'b@1'],
  );
});

test('media time subtracts the recording start and never goes negative', () => {
  assert.equal(mediaMs(5000, 1200), 3800);
  assert.equal(mediaMs(100, 1200), 0);
  assert.equal(mediaMs(null, 1200), null);
});

test('judge rows carry the four previous turns of their own conversation', () => {
  const turns = Array.from({ length: 6 }, (_, i) => ({
    conv: 'c',
    position: i,
    languages: ['vi', 'en'],
    sourceText: `s${i}`,
    displayText: null,
    sourceLanguages: ['vi'],
    translations: { en: `t${i}` },
    offsetMs: 1000 * i,
    audioOffsetMs: 500,
  }));
  const rows = judgeRows(turns, (text) => text.split(' ').length);
  assert.equal(rows[5].context.length, 4);
  assert.deepEqual(rows[5].context[0], { source: 's1', translation: 't1' });
  assert.equal(rows[0].context.length, 0);
  assert.equal(rows[2].mediaMs, 1500);
  assert.equal(rows[2].direction, 'vi_to_en');
});

test('word error counts substitutions, insertions and deletions over words', () => {
  assert.equal(wordError('a b c d', 'a b c d'), 0);
  assert.equal(wordError('a b c d', 'a x c'), 0.5);
  assert.equal(wordError('Xin chào!', 'xin chào'), 0);
});

test('candidates are heard right, translated into vi or en, and 5–30 words', () => {
  const base = { conv: 'c', translation: 't', scribe_missing: false, words: 10 };
  const rows = [
    {
      ...base,
      pos: 1,
      direction: 'vi_to_en',
      source: 'một hai ba bốn năm',
      scribe_source: 'một hai ba bốn năm',
    },
    {
      ...base,
      pos: 2,
      direction: 'vi_to_en',
      source: 'một hai ba bốn năm',
      scribe_source: 'sáu bảy tám chín mười',
    },
    { ...base, pos: 3, direction: 'vi_to_zh', source: 'a b c d e', scribe_source: 'a b c d e' },
    { ...base, pos: 4, direction: 'en_to_vi', source: 'a b', scribe_source: 'a b', words: 2 },
  ];
  assert.deepEqual(
    pickCandidates(rows).map((row) => row.id),
    ['c#1'],
  );
});

test('each rule changes the one thing it names', () => {
  assert.equal(RULES.number('at 8 p.m. on 15 May'), 'at 9 p.m. on 15 May');
  assert.equal(RULES.number('no digits'), null);
  assert.equal(RULES.negation("I don't know", 'en'), 'I do know');
  assert.equal(RULES.negation('It is late', 'en'), 'It is not late');
  assert.equal(RULES.negation('Tôi không biết', 'vi'), 'Tôi biết');
  assert.equal(RULES.negation('Tôi biết rồi', 'vi'), 'Tôi không biết rồi');
  assert.equal(RULES.name('Then Sarah said hello', 'en'), 'Then Daniel said hello');
  assert.equal(RULES.name('Hello. Then we left', 'en'), null);
  assert.equal(RULES.name('Rồi anh Hùng đi', 'vi'), 'Rồi anh Laura đi');
  assert.equal(
    RULES.omission('We met at the station, then we walked for a very long time to the old market'),
    'We met at the station',
  );
  assert.equal(RULES.omission('too short, really'), null);
});

test('broken copies spread over distinct turns and keep their original', () => {
  const bases = [
    {
      id: 'a',
      direction: 'vi_to_en',
      translation: 'It is 8 now and Sarah is not here, we wait for her at the gate',
    },
    {
      id: 'b',
      direction: 'vi_to_en',
      translation: 'They are here at 9 with Tom, and then everyone went home together late',
    },
  ];
  const broken = perturbRows(bases, 1);
  assert.deepEqual(
    broken.map((row) => row.kind),
    KINDS,
  );
  assert.notEqual(broken[0].base, broken[1].base);
  for (const row of broken) {
    assert.notEqual(row.translation, row.original);
    assert.equal(row.id, `${row.base}~${row.kind}`);
  }
});

test('calibration credits only errors blamed on the translation', () => {
  const clean = new Map([
    ['c1', [ans(), ans(), ans()]],
    ['c2', [ans(err('mt')), ans(err('mt')), ans()]],
  ]);
  const broken = new Map([
    ['c1~number', [ans(err('mt')), ans(err('mt')), ans(err('mt'))]],
    ['c1~name', [ans(err('asr')), ans(err('asr')), ans()]],
  ]);
  const set = [
    { id: 'c1~number', kind: 'number' },
    { id: 'c1~name', kind: 'name' },
  ];
  const n = calibrate(clean, broken, set);
  assert.equal(n.recall, 0.5);
  assert.equal(n.recallByKind.name.blamedOnHearing, 1);
  assert.equal(n.cleanFlags, 0.5);
  assert.deepEqual(n.cleanFlagged, ['c2']);
  assert.equal(n.agreement, 1);
  assert.equal(n.pass, false);
});

test('scores split serious findings by origin and resample conversations', () => {
  const turns = [
    { conv: 'a', pos: 0, direction: 'vi_to_en', words: 10 },
    { conv: 'a', pos: 1, direction: 'vi_to_en', words: 3 },
    { conv: 'b', pos: 0, direction: 'en_to_vi', words: 10 },
    { conv: 'b', pos: 1, direction: 'en_to_vi', words: 10 },
  ];
  const byId = new Map([
    ['a#0', [ans(err('asr')), ans(err('asr')), ans()]],
    ['a#1', [ans(err('mt', 'major', 'terminology')), ans(err('mt', 'major', 'terminology'))]],
    ['b#0', [ans(), ans(), ans()]],
    ['b#1', [ans(err('asr')), ans(err('asr')), ans(err('asr'))]],
  ]);
  const judged = judgedTurns(turns, byId);
  const point = stats(judged);
  assert.equal(point.anySerious, 0.75);
  assert.equal(point['errors:asr'], 2 / 3);
  assert.equal(point['mt:terminology'], 1);
  assert.match(verdict(point, bootstrap(judged, 200)), /^STT first/);
  const ci = bootstrap(judged, 500);
  assert.ok(ci.anySerious[0] <= 0.75 && ci.anySerious[1] >= 0.75);
});

test('the verdict needs a translation share whose interval clears 20%', () => {
  const point = {
    findings: 10,
    'errors:asr': 0.2,
    'errors:mt': 0.5,
    'errors:segmentation': 0.1,
    'mt:terminology': 0.1,
  };
  assert.match(verdict(point, { 'errors:mt': [0.3, 0.7] }), /^polish-lane review loop/);
  assert.match(verdict(point, { 'errors:mt': [0.1, 0.7] }), /^no single lever/);
});

test('a Claude call costs its tokens at the model price, cache reads included', async () => {
  const { costOf } = await import('./judge-providers.mjs');
  const usage = {
    input_tokens: 1_000_000,
    output_tokens: 100_000,
    cache_read_input_tokens: 1_000_000,
  };
  assert.equal(costOf('claude-opus-5-5', usage), 4 + 2 + 0.2);
  assert.equal(costOf('gemini-3.6-flash', usage), 0);
});

test('recorded spend sums every run under the results root', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { recordedSpend } = await import('./judge.mjs');
  const root = mkdtempSync(join(tmpdir(), 'judge-spend-'));
  for (const [dir, costs] of [
    ['a', [0.5, 0.25]],
    ['b', [1]],
  ]) {
    mkdirSync(join(root, dir));
    writeFileSync(
      join(root, dir, 'judgements.jsonl'),
      costs.map((costUsd) => JSON.stringify({ costUsd })).join('\n') + '\n',
    );
  }
  mkdirSync(join(root, 'empty'));
  assert.equal(recordedSpend(root), 1.75);
});

const corpusRow = (over = {}) => ({
  conv: 'c1',
  pos: 2,
  direction: 'vi_to_en',
  source: 'Ai sẽ thay thế lập trình viên',
  translation: 'Whoever will replace programmers',
  context: [
    { source: 'Hôm nay nói về AI', translation: 'Today we talk about AI' },
    { source: '', translation: '' },
  ],
  ...over,
});

test('a review arm asks the prod polisher with or without the earlier sources', () => {
  const blind = polishRequest(corpusRow(), 1);
  assert.deepEqual(blind, {
    source: 'Ai sẽ thay thế lập trình viên',
    draft: 'Whoever will replace programmers',
    sourceLanguage: 'vi',
    targetLanguage: 'en',
  });
  assert.deepEqual(polishRequest(corpusRow(), 2).context, ['Hôm nay nói về AI']);
});

test('a declined or failed polish leaves the stored line, marked as not rewritten', () => {
  const kept = armRow(corpusRow(), 2, { text: null, ms: 900, costUsd: 0.001 });
  assert.equal(kept.translation, 'Whoever will replace programmers');
  assert.equal(kept.rewritten, false);
  const failed = armRow(corpusRow(), 2, { error: 'timeout', ms: 8000, costUsd: 0 });
  assert.equal(failed.rewritten, false);
  assert.equal(failed.failed, 'timeout');
  const edited = armRow(corpusRow(), 2, {
    text: 'AI will replace programmers',
    ms: 1200,
    costUsd: 0,
  });
  assert.equal(edited.translation, 'AI will replace programmers');
  assert.equal(edited.rewritten, true);
});

test('reviewer cost uses the conservative per-token price', () => {
  assert.equal(costOf(1_000_000, 0), 1.74);
  assert.equal(costOf(undefined, undefined), 0);
});

test('a paired comparison keeps the baseline judgement for turns the arm left alone', () => {
  const mtErr = ans(err('mt'));
  const clean = ans();
  const base = new Map([
    ['c1#0', [mtErr, mtErr, clean]],
    ['c1#1', [clean, clean, clean]],
    ['c2#0', [mtErr, mtErr, mtErr]],
    ['c2#1', [clean, clean, clean]],
  ]);
  const arm = new Map([
    ['c1#0', [clean, clean, mtErr]],
    ['c1#1', [mtErr, mtErr, clean]],
  ]);
  const rows = [
    { conv: 'c1', pos: 0, direction: 'vi_to_en', rewritten: true, ms: 100 },
    { conv: 'c1', pos: 1, direction: 'vi_to_en', rewritten: true, ms: 200 },
    { conv: 'c2', pos: 0, direction: 'vi_to_en', rewritten: false, ms: 300 },
    { conv: 'c2', pos: 1, direction: 'vi_to_en', rewritten: true, ms: 400 },
  ];
  const { turns, missing } = pairTurns(rows, base, arm);
  assert.equal(missing, 1, 'a rewritten turn without arm judgements is counted, not scored');
  assert.equal(turns.length, 3);
  const point = pairedStats(turns);
  assert.equal(point['base:mt'], 2 / 3);
  assert.equal(point['arm:mt'], 2 / 3);
  assert.equal(point['fixed:mt'], 1);
  assert.equal(point['broken:mt'], 1);
  assert.equal(point['diff:mt'], 0);
  const ci = pairedBootstrap(turns, 200);
  assert.ok(ci.mt[0] <= 0 && ci.mt[1] >= 0);
  assert.equal(percentile([300, 100, 200], 0.95), 300);
});
