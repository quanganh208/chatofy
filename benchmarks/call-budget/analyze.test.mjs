import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyze, parseLlmLine, render } from './analyze.mjs';

const nest = (context, message) =>
  `\x1b[32m[Nest] 1  - \x1b[39m11/02/2026, 10:00:00 AM \x1b[32m    LOG\x1b[39m \x1b[38;5;3m[${context}] \x1b[39m\x1b[32m${message}\x1b[39m`;

const llm = (fields) =>
  nest(
    'LlmCall',
    `llm kind=${fields.kind} purpose=${fields.purpose ?? '-'} host=commandcode model=m ms=900 ok=${fields.ok ?? 1} ` +
      `in=${fields.in ?? '-'} out=${fields.out ?? '-'} cached=- h=${fields.h}`,
  );

const FIXTURE = [
  nest('TranslationSessionService', 'session.start t1 pair=vi→en mode=two-way voice=male'),
  nest('TranslationSessionService', 'session.start t2 pair=vi→en mode=two-way voice=male'),
  nest('TranslationSessionService', 'session.start t3 pair=vi→en mode=two-way voice=male'),
  llm({ kind: 'translate', purpose: 'live', in: 100, out: 10, h: 'aaaaaaaa' }),
  llm({ kind: 'translate', purpose: 'speculation', in: 120, out: 12, h: 'bbbbbbbb' }),
  llm({ kind: 'translate', purpose: 'final', in: 120, out: 12, h: 'bbbbbbbb' }),
  llm({ kind: 'homophones', h: 'cccccccc', ok: 0 }),
  llm({ kind: 'translate', purpose: 'speculation', in: 90, out: 9, h: 'dddddddd' }),
  llm({ kind: 'polish', in: 200, out: 20, h: 'eeeeeeee' }),
  nest('PipelineTranslatorService', 'homophones(commandcode) 2350ms accepted=1'),
  nest('PipelineTranslatorService', 'correction late, dropped'),
  nest('PipelineTranslatorService', 'fusion(deepseek) 512ms accepted=2'),
  nest(
    'TurnMetricsRecorder',
    'turn t1 ok (voice_off) firstAudio=900ms translated=900ms clauses=1 speculation=hit/2 live=1',
  ),
  nest(
    'TurnMetricsRecorder',
    'turn t2 ok (voice_off) firstAudio=1500ms translated=1500ms clauses=1 speculation=miss/1 live=0',
  ),
  nest(
    'TurnMetricsRecorder',
    'turn t3 FAILED (abandoned) firstAudio=0ms translated=3000ms clauses=0 speculation=miss/0 live=0',
  ),
  nest(
    'TurnMetricsRecorder',
    'turn t1 client outcome=played captured=2000ms held=0ms cut=hangover echo=0',
  ),
  nest(
    'TurnMetricsRecorder',
    'turn t2 client outcome=played captured=8000ms held=0ms cut=forced echo=0',
  ),
].join('\n');

test('counts turns, calls per turn, duplicates and late corrections', () => {
  const result = analyze(FIXTURE);
  assert.equal(result.turns, 3);
  assert.equal(result.starts, 3);
  assert.equal(result.calls, 6);
  assert.equal(result.callsPerTurn.toFixed(2), '2.00');
  assert.equal(result.duplicates, 1);
  assert.equal(result.translateCalls, 4);
  assert.equal(result.late, 1);
  assert.equal(result.homophoneLines, 1);
  assert.equal(result.homophonesAccepted, 1);
  assert.equal(result.unmetered, 1);
});

test('counts wasted speculation: earlier guesses on a hit, every guess on a miss', () => {
  const { speculation } = analyze(FIXTURE);
  assert.deepEqual(speculation, { hit: 1, miss: 2, spent: 3, wasted: 2 });
});

test('reads latency from server turn lines only', () => {
  const result = analyze(FIXTURE);
  assert.equal(result.translatedP50, 1500);
  assert.equal(result.translatedP95, 3000);
});

test('groups by kind and lane, and prints the lines later phases grep for', () => {
  const out = render(analyze(FIXTURE));
  assert.match(out, /^calls\/turn=2\.00$/m);
  assert.match(out, /^starts=3$/m);
  assert.match(out, /^unended=0$/m);
  assert.match(out, /\| translate\/speculation \| 2 \|/);
  assert.match(out, /\| homophones\/- \| 1 \| .* \| 1 \|$/m);
});

test('parses an llm line with missing counts as undefined', () => {
  const call = parseLlmLine(
    'llm kind=fusion purpose=- host=h model=m ms=12 ok=0 in=- out=- cached=- h=00ff00ff',
  );
  assert.equal(call.kind, 'fusion');
  assert.equal(call.purpose, undefined);
  assert.equal(call.in, undefined);
  assert.equal(call.ok, false);
});

test('counts fusion corrections and splits guesses by how the turn ended', () => {
  const result = analyze(FIXTURE);
  assert.equal(result.fusionLines, 1);
  assert.equal(result.fusionAccepted, 2);
  assert.deepEqual(result.guessesByCut, {
    hangover: { 'hit/2': 1 },
    forced: { 'miss/1': 1 },
    unknown: { 'miss/0': 1 },
  });
  assert.match(render(result), /^guesses on forced turns: miss\/1×1$/m);
});
