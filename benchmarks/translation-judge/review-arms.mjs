// What a second pass would have shown: the prod polisher replayed over the
// judged corpus, one "arm" per variant, so each can be judged like the baseline.
//
//   node review-arms.mjs --arm 2 [--model deepseek-v4-pro] [--limit 5] [--budget-usd 0.5]
//   node review-arms.mjs --arm 2 --host commandcode [--max-calls 170]
//
// Arms:
//   1  the polisher on the app's hearing with no context: what prod does today,
//      because neither call site passes one;
//   2  the same polisher given the earlier turns' sources, which is what
//      `ConversationContext.recall` would hand it live.
// Arm 0 is the stored translation and needs no call.
//
// Uses the prod class and prompt from `@chatofy/ai-providers` (build it first),
// so the arm tests the shipped pass and not a copy of it. A `null` from the
// polisher means the draft stands, exactly as live.
//
// On DeepSeek the reviewer bills the same key prod translates with, so the run
// refuses to start when the balance is under a floor and stops at its own cap.
// On Command Code (`--host commandcode`, prod's polisher: gpt-5.6-sol) the plan
// is a call quota shared with prod, not a balance, so the run stops at
// `--max-calls` instead.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DATA, HERE, readJsonl, turnId } from './rows.mjs';

export const ARMS = [1, 2];
const BASE_URL = 'https://api.deepseek.com';
/** Reviewer hosts; `commandcode` is the prod `commandcode-polish` row (same URL, model, no extra body). */
export const HOSTS = {
  deepseek: { baseUrl: BASE_URL, keyVar: 'OPENAI_COMPATIBLE_API_KEY', model: 'deepseek-v4-pro' },
  commandcode: {
    baseUrl: 'https://api.commandcode.ai/provider/v1',
    keyVar: 'COMMAND_CODE_API_KEY',
    model: 'gpt-5.6-sol',
  },
};
/**
 * USD per million tokens, the HIGHEST first-party rate seen for
 * deepseek-v4-pro (web sources disagreed, 2026-11-02): an estimate that errs
 * towards stopping early. The balance delta printed at the end is the truth.
 */
const PRICE = { input: 1.74, output: 3.96 };
export const BALANCE_FLOOR_USD = 1.0;

export const languagesOf = (row) => row.direction.split('_to_');

/** What the live polisher would be asked for this row under `arm`. */
export function polishRequest(row, arm) {
  const [sourceLanguage, targetLanguage] = languagesOf(row);
  const request = { source: row.source, draft: row.translation, sourceLanguage, targetLanguage };
  if (arm === 2) request.context = (row.context ?? []).map((turn) => turn.source).filter(Boolean);
  return request;
}

/** The corpus row as the arm shows it: the polished line, or the draft when the pass declined. */
export function armRow(row, arm, outcome) {
  return {
    ...row,
    arm,
    translation: outcome.text ?? row.translation,
    rewritten: Boolean(outcome.text),
    failed: outcome.error ?? undefined,
    ms: outcome.ms,
    costUsd: outcome.costUsd,
  };
}

export const costOf = (inputTokens = 0, outputTokens = 0) =>
  (inputTokens * PRICE.input + outputTokens * PRICE.output) / 1e6;

export function loadKey(name = 'OPENAI_COMPATIBLE_API_KEY') {
  if (process.env[name]) return process.env[name];
  const env = resolve(HERE, '..', '..', '.env');
  const line =
    existsSync(env) &&
    readFileSync(env, 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} is not set in the environment or the repo-root .env`);
  return line
    .slice(name.length + 1)
    .trim()
    .replace(/^["']|["']$/g, '');
}

export async function balance(key) {
  const response = await fetch(`${BASE_URL}/user/balance`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const json = await response.json();
  const usd = json.balance_infos?.find((b) => b.currency === 'USD');
  return usd ? Number(usd.total_balance) : NaN;
}

function parseArgs(argv) {
  const args = {
    host: 'deepseek',
    budgetUsd: 0.5,
    maxCalls: 170,
    concurrency: 4,
    limit: Infinity,
    resume: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i];
    const value = argv[i + 1];
    if (name === '--arm') args.arm = Number(value);
    else if (name === '--model') args.model = value;
    else if (name === '--host') args.host = value;
    else if (name === '--max-calls') args.maxCalls = Number(value);
    else if (name === '--in') args.in = value;
    else if (name === '--out') args.out = value;
    else if (name === '--budget-usd') args.budgetUsd = Number(value);
    else if (name === '--concurrency') args.concurrency = Number(value);
    else if (name === '--limit') args.limit = Number(value);
    else if (name === '--resume') {
      args.resume = true;
      continue;
    } else throw new Error(`unknown flag ${name}`);
    i += 1;
  }
  if (!ARMS.includes(args.arm)) throw new Error(`--arm must be one of ${ARMS.join(', ')}`);
  if (!HOSTS[args.host]) throw new Error(`--host must be one of ${Object.keys(HOSTS).join(', ')}`);
  args.model ??= HOSTS[args.host].model;
  args.in ??= join(DATA, 'turns.scribed.jsonl');
  args.out ??= join(DATA, 'arms', `arm-${args.arm}-${args.model}.jsonl`);
  return args;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const { OpenAiCompatibleTranslationPolisher } =
    await import('../../packages/ai-providers/dist/index.js');
  const host = HOSTS[args.host];
  const onDeepSeek = args.host === 'deepseek';
  const key = loadKey(host.keyVar);
  const before = onDeepSeek ? await balance(key) : NaN;
  if (onDeepSeek) {
    console.error(`DeepSeek balance: $${before.toFixed(2)} (floor $${BALANCE_FLOOR_USD})`);
    if (!(before >= BALANCE_FLOOR_USD)) {
      console.error('balance under the floor: the same key serves prod translation; top up first');
      process.exit(3);
    }
  }

  const rows = readJsonl(args.in).filter((row) => row.translation);
  mkdirSync(dirname(args.out), { recursive: true });
  const done = new Set();
  if (existsSync(args.out)) {
    if (!args.resume) throw new Error(`${args.out} exists; pass --resume to continue it`);
    for (const row of readJsonl(args.out)) if (!row.failed) done.add(turnId(row));
    // Failed rows are retried: keep only the good ones.
    writeFileSync(
      args.out,
      readJsonl(args.out)
        .filter((row) => !row.failed)
        .map((row) => JSON.stringify(row) + '\n')
        .join(''),
    );
  }
  const todo = rows.filter((row) => !done.has(turnId(row))).slice(0, args.limit);

  // One polisher per worker, each with its own call hook, so a call's usage
  // is read from that call's event and not from a neighbour's.
  const makePolisher = () => {
    const hook = { last: null };
    const polisher = new OpenAiCompatibleTranslationPolisher({
      apiKey: key,
      baseUrl: host.baseUrl,
      model: args.model,
      name: `${args.host}-review-arm`,
      // Same as the prod `deepseek` row: thinking is on by default and would
      // spend the 8 s window on a reasoning pass. The prod Command Code row
      // sends no extra body.
      extraBody: onDeepSeek ? { thinking: { type: 'disabled' } } : undefined,
      onCall: (event) => {
        hook.last = event;
      },
    });
    return { polisher, hook };
  };

  let spent = 0;
  let calls = 0;
  let next = 0;
  let stopped = false;
  const worker = async () => {
    const { polisher, hook } = makePolisher();
    while (next < todo.length && !stopped) {
      const row = todo[next++];
      if (onDeepSeek ? spent >= args.budgetUsd : calls >= args.maxCalls) {
        stopped = true;
        break;
      }
      calls += 1;
      const started = Date.now();
      let outcome;
      try {
        const text = await polisher.polish(polishRequest(row, args.arm));
        outcome = { text };
      } catch (err) {
        outcome = { error: err instanceof Error ? err.message : String(err) };
      }
      // The hook fires in `polish`'s finally, before it returns or throws.
      const call = hook.last;
      hook.last = null;
      outcome.ms = Date.now() - started;
      // A plan quota, not a bill: no per-token price to estimate.
      outcome.costUsd = onDeepSeek ? costOf(call?.inputTokens, call?.outputTokens) : 0;
      spent += outcome.costUsd;
      appendFileSync(args.out, JSON.stringify(armRow(row, args.arm, outcome)) + '\n');
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, args.concurrency) }, worker));

  const out = readJsonl(args.out);
  const spend = onDeepSeek
    ? `estimated $${spent.toFixed(3)}, balance $${before.toFixed(2)} → $${(await balance(key)).toFixed(2)}`
    : `${calls} calls on ${args.host}`;
  console.error(
    `arm ${args.arm}: ${out.length}/${rows.length} rows, ${out.filter((r) => r.rewritten).length} rewritten, ` +
      `${out.filter((r) => r.failed).length} failed; ${spend}${stopped ? ' (stopped at cap)' : ''}`,
  );
  if (stopped) process.exit(3);
}
