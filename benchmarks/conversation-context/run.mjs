// Translate the corpus turn by turn, in conversation order, once per repeat.
//
//   DEEPSEEK_API_KEY=… node benchmarks/conversation-context/run.mjs \
//     --arm baseline|oracle --repeats 3 --limit-calls <n> [--data <dir>] [--provider deepseek]
//
// Spends real money: one paid call per row per repeat. It prints the planned
// count first and refuses (exit 2, no call made) when the corpus is not
// finished or the count is above `--limit-calls`. Never wired into tests or CI.
//
// The arms differ ONLY in the hints a turn carries:
//
// - `baseline`: what prod sends today with no conversation state, which is the
//   turn's text plus its last four same-language utterances as `context` (the
//   provider itself drops that context from a turn longer than four words).
// - `oracle`: the same, plus the conversation state a perfect digest would
//   have held at that turn, built from the user's own corpus and injected
//   under the rules the shipped digest must follow (`oracleHints`). It answers
//   whether a conversation state can help this model at all, before any digest
//   is written.
// - `digest`: reserved for the real digest; refused until it exists.
//
// It drives the shipped provider (`translation-providers.mjs`) and never
// declares a prompt, for the reason that file gives.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { foldForMatch } from '../../packages/ai-providers/dist/index.js';
import { makeTranslationProvider, takeProviderArgs } from '../translation-providers.mjs';
import {
  DATA,
  HERE,
  LANGUAGES,
  byConversation,
  corpusProblems,
  readJsonl,
  typesModule,
} from './corpus.mjs';

/** What `ConversationContext.recall` hands a turn: the last four earlier utterances. */
const CONTEXT_UTTERANCES = 4;
/** The prompt builder's glossary ceiling and its per-side word cap. */
const MAX_GLOSSARY = 24;
const MAX_GLOSSARY_WORDS = 4;
/** `needsPriorSpeech` in `prompt-builder.ts`: a turn of at most four words is a fragment. */
const MAX_FRAGMENT_WORDS = 4;

const ARMS = ['baseline', 'oracle', 'digest'];

function parseArgs(argv) {
  const args = { arm: null, repeats: 1, limitCalls: null, data: DATA };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const raw = argv[i + 1];
    if (raw === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--arm') args.arm = raw;
    else if (flag === '--repeats') args.repeats = Number(raw);
    else if (flag === '--limit-calls') args.limitCalls = Number(raw);
    else if (flag === '--data') args.data = raw;
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!ARMS.includes(args.arm)) throw new Error(`--arm must be one of ${ARMS.join(', ')}`);
  if (!Number.isInteger(args.repeats) || args.repeats < 1) {
    throw new Error('--repeats needs an integer >= 1');
  }
  return args;
}

/** The earlier utterances in this turn's source language, newest last. */
export function contextFor(turn, earlier) {
  const language = LANGUAGES[turn.direction].source;
  return earlier
    .filter((row) => LANGUAGES[row.direction].source === language)
    .slice(-CONTEXT_UTTERANCES)
    .map((row) => row.source);
}

/**
 * The hints a perfect conversation state would add to this turn.
 *
 * Built only from what that state could have known AT this turn, and only
 * under the rules the shipped digest must follow, so the oracle measures the
 * design rather than a looser one:
 *
 * - glossary: a term is offered only when an EARLIER turn said it and THIS
 *   turn says it too, rendered as the user rendered it; at most 24 pairs, each
 *   side at most four words, as the prompt builder caps them;
 * - topic: the conversation's domain, only for a turn of at most four words,
 *   because the prompt builder writes `Subject:` into every prompt it is given
 *   and a complete sentence can be pulled to the wrong sense by it.
 */
export function oracleHints(turn, earlier, domain, countTermWords) {
  const { source: from, target: to } = LANGUAGES[turn.direction];
  const here = foldForMatch(turn.source);
  const before = earlier.map((row) => foldForMatch(row.source));
  const glossary = [];
  const seen = new Set();
  for (const row of [...earlier, turn]) {
    if (row.direction !== turn.direction) continue;
    for (const term of row.terms ?? []) {
      const key = foldForMatch(term.source);
      if (!key || seen.has(key)) continue;
      if (!here.includes(key) || !before.some((text) => text.includes(key))) continue;
      if (
        countTermWords(term.source) > MAX_GLOSSARY_WORDS ||
        countTermWords(term.target) > MAX_GLOSSARY_WORDS
      ) {
        continue;
      }
      seen.add(key);
      glossary.push({ [from]: term.source, [to]: term.target });
      if (glossary.length === MAX_GLOSSARY) break;
    }
    if (glossary.length === MAX_GLOSSARY) break;
  }
  const words = countTermWords(turn.source);
  const hints = {};
  if (words > 0 && words <= MAX_FRAGMENT_WORDS && domain) hints.topic = domain;
  if (glossary.length) hints.glossary = glossary;
  return Object.keys(hints).length ? hints : undefined;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const { provider: providerArgs, rest } = takeProviderArgs(process.argv.slice(2));
  const args = parseArgs(rest);
  if (args.arm === 'digest') {
    console.error('arm digest needs the conversation digest, which does not exist yet');
    process.exit(2);
  }

  const rows = readJsonl(join(args.data, 'corpus.jsonl'));
  const conversations = readJsonl(join(args.data, 'conversations.jsonl'));
  const planned = rows.length * args.repeats;
  console.error(`planned: ${planned} calls (${rows.length} rows × ${args.repeats} repeats)`);

  const problems = corpusProblems(rows, conversations, { needDomain: args.arm === 'oracle' });
  if (problems.length) {
    console.error(`refused, the corpus is not finished (${problems.length}):`);
    for (const problem of problems.slice(0, 40)) console.error(`  ${problem}`);
    process.exit(2);
  }
  if (!Number.isInteger(args.limitCalls) || args.limitCalls < 1) {
    console.error('refused: --limit-calls <n> is required');
    process.exit(2);
  }
  if (planned > args.limitCalls) {
    console.error(`refused: ${planned} planned calls exceed --limit-calls ${args.limitCalls}`);
    process.exit(2);
  }

  const { countTermWords } = await typesModule();
  const { provider, models, gapMs } = makeTranslationProvider({
    preset: 'deepseek',
    ...providerArgs,
  });
  const domains = new Map(conversations.map((c) => [c.conv, c.domain]));
  let spent = 0;

  for (let repeat = 1; repeat <= args.repeats; repeat += 1) {
    const out = [];
    for (const [conv, turns] of byConversation(rows)) {
      for (const [index, turn] of turns.entries()) {
        const earlier = turns.slice(0, index);
        const { source, target } = LANGUAGES[turn.direction];
        const hints =
          args.arm === 'oracle'
            ? oracleHints(turn, earlier, domains.get(conv), countTermWords)
            : undefined;
        const started = Date.now();
        let hypothesis = '';
        let error = null;
        try {
          const result = await provider.translate({
            text: turn.source,
            sourceLanguage: source,
            targetLanguage: target,
            context: contextFor(turn, earlier),
            purpose: 'final',
            ...(hints ? { hints } : {}),
          });
          hypothesis = result.text ?? '';
        } catch (err) {
          // Kept as a failed row: a turn that never answered must not score as
          // a turn that answered well.
          error = String(err);
          console.error(`  ${conv}#${turn.pos} failed: ${error}`);
        }
        spent += 1;
        out.push({
          ...turn,
          arm: args.arm,
          repeat,
          hints: hints ?? null,
          hypothesis,
          error,
          model: models[0],
          totalMs: Date.now() - started,
        });
        await sleep(gapMs);
      }
    }
    const dir = join(HERE, 'results', `${args.arm}-r${repeat}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'rows.jsonl'), out.map((row) => JSON.stringify(row)).join('\n') + '\n');
    console.error(`repeat ${repeat}: ${out.length} rows → ${dir} (spent ${spent})`);
  }
}
