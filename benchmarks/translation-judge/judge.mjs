// Ask the judge about every turn of an input file, `--repeats` times each.
//
//   node benchmarks/translation-judge/judge.mjs --in data/turns.scribed.jsonl \
//     --out results/<run> --model <id> --repeats 3 --limit-calls <n> \
//     [--effort medium] [--budget-usd 100] [--resume]
//
// A `claude-*` model runs on the Anthropic API (key from ANTHROPIC_API_KEY, else
// that line of the repo-root .env); any other on Gemini (GEMINI_API_KEY, several
// comma-separated keys rotated on 429). See `judge-providers.mjs`.
//
// Every row needs `conv`, `pos`, `direction`, `source`, `translation`; an `id`
// is used when present (calibration rows carry one), else `conv#pos`. Rows
// without a translation are skipped and counted: there is nothing to judge.
//
// Prints the planned call count and exits 2 above `--limit-calls` before the
// first request. `--out` must be a new directory unless `--resume` is given;
// a resumed run only adds the (row, repeat) pairs that have no answer yet and
// never rewrites one that does, so a recorded run is never changed by a later
// one. Answers go to `<out>/judgements.jsonl`, one line per call, with the
// model that gave it and, for Claude, what it cost.
//
// `--budget-usd` caps the spend of EVERY run under `results/`, not just this
// one: the money is one account's credit. Spend is summed from the recorded
// answers at start and as calls return; no new call starts once it is reached.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { claudeAsker, geminiAsker, isClaude } from './judge-providers.mjs';
import { HERE, RESULTS, readJsonl, turnId } from './rows.mjs';

function parseArgs(argv) {
  const args = {
    in: null,
    out: null,
    model: null,
    repeats: 3,
    limitCalls: 0,
    resume: false,
    concurrency: 4,
    effort: 'medium',
    budgetUsd: 100,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--in') args.in = argv[++i];
    else if (flag === '--out') args.out = argv[++i];
    else if (flag === '--model') args.model = argv[++i];
    else if (flag === '--repeats') args.repeats = Number(argv[++i]);
    else if (flag === '--limit-calls') args.limitCalls = Number(argv[++i]);
    else if (flag === '--concurrency') args.concurrency = Number(argv[++i]);
    else if (flag === '--resume') args.resume = true;
    else if (flag === '--effort') args.effort = argv[++i];
    else if (flag === '--budget-usd') args.budgetUsd = Number(argv[++i]);
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!args.in || !args.out || !args.model) throw new Error('--in, --out and --model are required');
  if (!(args.repeats >= 1)) throw new Error('--repeats must be at least 1');
  return args;
}

/** The (row, repeat) pairs still to ask, given what the output already holds. */
export function pendingCalls(rows, repeats, done) {
  const calls = [];
  for (const row of rows) {
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      if (!done.has(`${row.id}@${repeat}`)) calls.push({ row, repeat });
    }
  }
  return calls;
}

/** Dollars already spent by every recorded run under `results/`. */
export function recordedSpend(root = RESULTS) {
  if (!existsSync(root)) return 0;
  let total = 0;
  for (const dir of readdirSync(root)) {
    const file = join(root, dir, 'judgements.jsonl');
    if (existsSync(file)) for (const line of readJsonl(file)) total += line.costUsd ?? 0;
  }
  return total;
}

function loadAnthropicKey() {
  if (process.env.ANTHROPIC_API_KEY) return;
  const env = resolve(HERE, '..', '..', '.env');
  const line =
    existsSync(env) &&
    readFileSync(env, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('ANTHROPIC_API_KEY='));
  if (!line)
    throw new Error('ANTHROPIC_API_KEY is not set in the environment or the repo-root .env');
  process.env.ANTHROPIC_API_KEY = line
    .slice('ANTHROPIC_API_KEY='.length)
    .trim()
    .replace(/^["']|["']$/g, '');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const out = resolve(args.out);
  const file = join(out, 'judgements.jsonl');
  if (existsSync(out) && !args.resume) {
    console.error(
      `${out} exists; pass --resume to add the missing answers, or pick a new directory`,
    );
    process.exit(2);
  }
  const all = readJsonl(resolve(args.in)).map((row) => ({ ...row, id: row.id ?? turnId(row) }));
  const rows = all.filter((row) => row.translation);
  const done = new Set();
  if (existsSync(file)) {
    for (const answer of readJsonl(file)) {
      if (answer.model !== args.model) {
        console.error(`${file} holds answers from ${answer.model}; one run is one model`);
        process.exit(2);
      }
      if (!answer.failed) done.add(`${answer.id}@${answer.repeat}`);
    }
  }
  const calls = pendingCalls(rows, args.repeats, done);
  console.error(
    `${rows.length} rows (${all.length - rows.length} without a translation skipped) × ${args.repeats} repeats: ` +
      `${calls.length} calls planned, ${done.size} already answered`,
  );
  if (calls.length > args.limitCalls) {
    console.error(`refusing: ${calls.length} calls is above --limit-calls ${args.limitCalls}`);
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });
  if (!existsSync(join(out, 'meta.json'))) {
    writeFileSync(
      join(out, 'meta.json'),
      JSON.stringify(
        {
          model: args.model,
          effort: isClaude(args.model) ? args.effort : null,
          in: args.in,
          repeats: args.repeats,
          started: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  }

  if (isClaude(args.model)) loadAnthropicKey();
  const ask = isClaude(args.model) ? claudeAsker(args.model, args.effort) : geminiAsker(args.model);
  let spent = recordedSpend();
  console.error(`spent so far under results/: $${spent.toFixed(2)} of $${args.budgetUsd}`);
  let next = 0;
  let failed = 0;
  let stoppedForBudget = false;
  async function worker() {
    while (next < calls.length) {
      if (spent >= args.budgetUsd) {
        stoppedForBudget = true;
        return;
      }
      const { row, repeat } = calls[next++];
      const line = { id: row.id, conv: row.conv, pos: row.pos, repeat, model: args.model };
      if (isClaude(args.model)) line.effort = args.effort;
      try {
        Object.assign(line, await ask(row));
        spent += line.costUsd ?? 0;
      } catch (error) {
        failed += 1;
        line.failed = error.message;
      }
      appendFileSync(file, JSON.stringify(line) + '\n');
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, args.concurrency) }, worker));
  const asked = Math.min(next, calls.length);
  console.error(
    `${asked - failed} answered, ${failed} failed → ${file}; spent under results/: $${spent.toFixed(2)}`,
  );
  if (stoppedForBudget) {
    console.error(
      `stopped: the $${args.budgetUsd} budget is reached, ${calls.length - asked} calls not made`,
    );
    process.exit(3);
  }
  if (failed) process.exit(1);
}
