// Asks a decision model (Jev or Gemini Decision 1) the polish-gate and
// omission questions over one set of turns, and records every raw answer.
//
//   node decision-gate.mjs --model <jev|gemini> --set <judged|calibration|trailing|solo> \
//     --out results/decision-<model>-<set> --repeats 3 --limit-calls <n> [--resume] [--dry-run]
//
// Sets:
//   judged       the 162 labelled prod turns (data/decision/labels.jsonl), arms ctx and noctx,
//                both questions in one request
//   calibration  cal-broken (30) and cal-clean (40), both questions, ctx
//   trailing     data/decision/trailing-drops.jsonl, both questions, ctx
//   solo         the first 50 labelled turns, each question in its own request, ctx
//
// Prints the planned call count and exits 2 above --limit-calls before the first
// request. Every HTTP attempt, retries included, counts toward the cap. Answers are
// appended one line per request to <out>/answers.jsonl; --resume skips the
// (id, arm, repeat, questions) tuples already answered. A refused or unreachable
// host, or the cap, stops the sitting (exit 3); a request the host rejects outright
// (e.g. a safety block) is recorded as failed and the run goes on.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CallCounter, askerFor } from './decision-providers.mjs';
import { questionsFor, stateFor } from './decision-questions.mjs';
import { DATA, readJsonl, turnId } from './rows.mjs';

const BOTH = ['fidelity', 'omission'];
const SETS = ['judged', 'calibration', 'trailing', 'solo'];
export const SOLO_TURNS = 50;

function parseArgs(argv) {
  const args = { repeats: 3, resume: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--model') args.model = argv[++i];
    else if (flag === '--set') args.set = argv[++i];
    else if (flag === '--out') args.out = argv[++i];
    else if (flag === '--repeats') args.repeats = Number(argv[++i]);
    else if (flag === '--limit-calls') args.limitCalls = Number(argv[++i]);
    else if (flag === '--resume') args.resume = true;
    else if (flag === '--dry-run') args.dryRun = true;
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!['jev', 'gemini'].includes(args.model)) throw new Error('--model must be jev or gemini');
  if (!SETS.includes(args.set)) throw new Error(`--set must be one of ${SETS.join(', ')}`);
  if (!args.out) throw new Error('--out is required');
  if (!Number.isInteger(args.repeats) || args.repeats < 1)
    throw new Error('--repeats must be a positive integer');
  if (!Number.isFinite(args.limitCalls)) throw new Error('--limit-calls is required');
  return args;
}

/** Labels rows carry the draft as `draft`; the model reads it as `translation`. */
function labelTurns() {
  return readJsonl(join(DATA, 'decision', 'labels.jsonl')).map((row) => ({
    ...row,
    id: turnId(row),
    translation: row.draft,
  }));
}

/** The requests one set needs before repeats: {id, arm, questionKeys, row, group, kind}. */
export function itemsFor(set, sources = {}) {
  if (set === 'judged') {
    const turns = sources.labels ?? labelTurns();
    return ['ctx', 'noctx'].flatMap((arm) =>
      turns.map((row) => ({ id: row.id, arm, questionKeys: BOTH, row, group: 'judged' })),
    );
  }
  if (set === 'solo') {
    const turns = [...(sources.labels ?? labelTurns())]
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, SOLO_TURNS);
    return BOTH.flatMap((kind) =>
      turns.map((row) => ({ id: row.id, arm: 'ctx', questionKeys: [kind], row, group: 'solo' })),
    );
  }
  if (set === 'calibration') {
    const broken = sources.broken ?? readJsonl(join(DATA, 'calibration-perturbed.jsonl'));
    const clean = sources.clean ?? readJsonl(join(DATA, 'calibration-clean.jsonl'));
    return [
      ...broken.map((row) => ({
        id: row.id,
        arm: 'ctx',
        questionKeys: BOTH,
        row,
        group: 'broken',
        kind: row.kind,
      })),
      ...clean.map((row) => ({
        id: row.id,
        arm: 'ctx',
        questionKeys: BOTH,
        row,
        group: 'clean',
        kind: 'clean',
      })),
    ];
  }
  const drops = sources.trailing ?? readJsonl(join(DATA, 'decision', 'trailing-drops.jsonl'));
  return drops.map((row) => ({
    id: row.id,
    arm: 'ctx',
    questionKeys: BOTH,
    row,
    group: 'trailing',
    kind: 'trailing',
  }));
}

export function callKey({ id, arm, repeat, questionKeys }) {
  return `${id}|${arm}|${repeat}|${questionKeys.join('+')}`;
}

/** Every (item, repeat) without a recorded, non-failed answer. */
export function pendingCalls(items, repeats, done = new Set()) {
  const calls = [];
  for (let repeat = 1; repeat <= repeats; repeat += 1)
    for (const item of items) {
      const call = { ...item, repeat };
      if (!done.has(callKey(call))) calls.push(call);
    }
  return calls;
}

function answeredKeys(file) {
  if (!existsSync(file)) return new Set();
  return new Set(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((line) => !line.failed)
      .map(callKey),
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const answersFile = join(args.out, 'answers.jsonl');
  const calls = pendingCalls(itemsFor(args.set), args.repeats, answeredKeys(answersFile));
  console.log(`planned ${calls.length} calls`);
  if (calls.length > args.limitCalls) {
    console.error(`refusing: ${calls.length} calls is above --limit-calls ${args.limitCalls}`);
    process.exit(2);
  }
  if (args.dryRun) process.exit(0);
  if (existsSync(args.out) && !args.resume) {
    console.error(
      `${args.out} exists; pass --resume to add the missing answers, or pick a new directory`,
    );
    process.exit(2);
  }
  mkdirSync(args.out, { recursive: true });
  const metaFile = join(args.out, 'meta.json');
  if (!existsSync(metaFile))
    writeFileSync(
      metaFile,
      JSON.stringify(
        {
          model: args.model,
          set: args.set,
          repeats: args.repeats,
          started: new Date().toISOString(),
          latencyNote: 'measured from the dev desk, not the prod host',
        },
        null,
        2,
      ) + '\n',
    );
  const counter = new CallCounter(args.limitCalls);
  const ask = askerFor(args.model, { counter });
  let answered = 0;
  let failed = 0;
  // HTTP attempts summed over every sitting of this run, and how many of the
  // set's (item, repeat) pairs now hold an answer: the Verify step reads these.
  const finish = (code) => {
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
    meta.httpAttempts = (meta.httpAttempts ?? 0) + counter.used;
    const total = pendingCalls(itemsFor(args.set), args.repeats).length;
    const complete = answeredKeys(answersFile).size;
    meta.complete = { answered: complete, of: total };
    writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');
    console.log(`complete ${complete} of ${total}; ${meta.httpAttempts} HTTP attempts in this run`);
    process.exit(code);
  };
  for (const call of calls) {
    const withContext = call.arm === 'ctx';
    const questions = questionsFor(call.questionKeys, { shuffleSeed: call.repeat, withContext });
    const record = {
      id: call.id,
      set: args.set,
      group: call.group,
      kind: call.kind ?? null,
      arm: call.arm,
      repeat: call.repeat,
      questionKeys: call.questionKeys,
      model: args.model,
      criteriaOrder: questions.fidelity ? Object.keys(questions.fidelity.criteria) : null,
    };
    try {
      const out = await ask(stateFor(call.row, { withContext }), questions);
      appendFileSync(
        answersFile,
        JSON.stringify({
          ...record,
          answers: out.answers,
          usage: out.usage,
          ms: out.ms,
          servedBy: out.servedBy,
          at: new Date().toISOString(),
        }) + '\n',
      );
      answered += 1;
    } catch (error) {
      if (error.code === 'CALL_CAP' || error.code === 'HOST_UNAVAILABLE') {
        console.error(
          `stopped: ${error.message}; ${answered} answered, ${calls.length - answered - failed} not asked`,
        );
        finish(3);
      }
      appendFileSync(
        answersFile,
        JSON.stringify({
          ...record,
          failed: true,
          error: error.message,
          at: new Date().toISOString(),
        }) + '\n',
      );
      failed += 1;
      console.error(`${callKey(call)}: ${error.message}`);
    }
    if ((answered + failed) % 50 === 0)
      console.error(`${answered + failed}/${calls.length} (${counter.used} HTTP attempts)`);
  }
  console.error(`done: ${answered} answered, ${failed} failed, ${counter.used} HTTP attempts`);
  finish(0);
}
