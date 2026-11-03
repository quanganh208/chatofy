// Does the block path still render a sentence that continues the previous
// turn as a command? Ten runs per arm on one known case.
//
//   node fragment-arms.mjs [--row <conv#pos>] [--in data/conv-7a5c5edb.scribed.jsonl] [--runs 10]
//
// The case is conversation 7a5c5edb, row 18: "See the future that you see. So,
// I'm going to ask about three areas…", the continuation of "So my goal is to
// help that audience." in the turn before. Prod rendered it "Hãy nhìn vào…".
//
// Arms, each built on the shipped provider and polisher from
// `@chatofy/ai-providers` (build it first):
//   A  the block translated with no context: what prod's block call does today;
//   B  translated with the earlier rows as context and the prior-speech gate
//      open (`continuesCut: true` is how a request opens it);
//   C  B, then polished with that context;
//   D  the stored translation polished with that context, no re-translation.
// A run counts as non-imperative when its text does not open with "Hãy".
//
// Bills the DeepSeek key prod translates with, so it refuses under the same
// balance floor as review-arms.mjs.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { BALANCE_FLOOR_USD, balance, costOf, loadKey } from './review-arms.mjs';
import { DATA, HERE, readJsonl, turnId } from './rows.mjs';

const BASE_URL = 'https://api.deepseek.com';
const ARMS = ['A', 'B', 'C', 'D'];
const BUDGET_USD = 0.3;
const IMPERATIVE = /^\s*Hãy\b/u;

const flag = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
};
const rowId = flag('--row', '7a5c5edb-63f7-4d90-8326-745d99c8eded#18');
const input = flag('--in', join(DATA, 'conv-7a5c5edb.scribed.jsonl'));
const runs = Number(flag('--runs', '10'));
const out = join(HERE, 'results', 'fragment-arms.jsonl');

const row = readJsonl(input).find((r) => turnId(r) === rowId);
if (!row) throw new Error(`${rowId} is not in ${input}`);
const [sourceLanguage, targetLanguage] = row.direction.split('_to_');
const context = (row.context ?? []).map((turn) => turn.source).filter(Boolean);

const { OpenAiCompatibleTranslationPolisher, OpenAiCompatibleTranslationProvider } =
  await import('../../packages/ai-providers/dist/index.js');
const key = loadKey();
const before = await balance(key);
if (!(before >= BALANCE_FLOOR_USD)) {
  console.error(`DeepSeek balance $${before} is under the $${BALANCE_FLOOR_USD} floor`);
  process.exit(3);
}

let spent = 0;
const onCall = (event) => {
  spent += costOf(event?.inputTokens, event?.outputTokens);
};
const translator = new OpenAiCompatibleTranslationProvider({
  apiKey: key,
  baseUrl: BASE_URL,
  models: ['deepseek-flash'],
  name: 'deepseek-fragment-arm',
  extraBody: { thinking: { type: 'disabled' } },
  onCall,
});
const polisher = new OpenAiCompatibleTranslationPolisher({
  apiKey: key,
  baseUrl: BASE_URL,
  model: 'deepseek-v4-pro',
  name: 'deepseek-fragment-arm',
  extraBody: { thinking: { type: 'disabled' } },
  onCall,
});

const translate = async (withContext) =>
  (
    await translator.translate({
      text: row.source,
      sourceLanguage,
      targetLanguage,
      ...(withContext ? { context, continuesCut: true } : {}),
    })
  ).text;
const polish = async (draft) =>
  (await polisher.polish({ source: row.source, draft, sourceLanguage, targetLanguage, context })) ??
  draft;

const produce = {
  A: () => translate(false),
  B: () => translate(true),
  C: async () => polish(await translate(true)),
  D: () => polish(row.translation),
};

mkdirSync(dirname(out), { recursive: true });
for (const arm of ARMS) {
  let ok = 0;
  for (let run = 0; run < runs; run += 1) {
    if (spent >= BUDGET_USD) throw new Error(`stopped at the $${BUDGET_USD} budget`);
    const text = await produce[arm]();
    if (!IMPERATIVE.test(text)) ok += 1;
    appendFileSync(out, JSON.stringify({ row: rowId, arm, run, text }) + '\n');
  }
  console.log(`arm ${arm}: ${ok}/${runs} non-imperative`);
}
console.error(
  `estimated $${spent.toFixed(3)}; balance $${before.toFixed(2)} → $${(await balance(key)).toFixed(2)}`,
);
