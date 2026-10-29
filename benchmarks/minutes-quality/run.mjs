// How good are the minutes the shipped summarizer writes?
//
// Run manually. Every item spends one metered generation and one metered judge
// call, so it is never wired into `pnpm test` or CI. Like `minutes-injection`, it
// drives the shipped provider from dist rather than a copy of the prompt.
//
//   pnpm --filter @chatofy/ai-providers build   # loads dist/, not src/
//   node benchmarks/minutes-quality/run.mjs --arm commandcode
//   node benchmarks/minutes-quality/run.mjs --arm gemini
//
// Each run writes a NEW directory and refuses to reuse one: a harness that
// appended into an existing results dir has already rewritten numbers a report
// quoted. `rows.jsonl` holds the minutes and the judge's notes — text drawn from
// production transcripts — and is gitignored; `summary.json` holds only numbers.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  buildMinutesInstruction,
  buildMinutesReminder,
} from '../../packages/ai-providers/dist/index.js';
import { MINUTES_HOSTS, makeMinutesProvider } from '../minutes-providers.mjs';
import { readApiKey } from '../translation-providers.mjs';
import { SYNTHETIC } from './synthetic-corpus.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const REAL_CORPUS = resolve(REPO, 'benchmarks/homophone-repair/data/conversations.json');

const JUDGE_URL = `${MINUTES_HOSTS.commandcode.baseUrl}/messages`;
const JUDGE_MODEL = 'claude-sonnet-5-5';
const JUDGE_TIMEOUT_MS = 120_000;
const SCORES = ['faithfulness', 'coverage', 'language', 'usefulness', 'speakerAttribution'];

/**
 * The rubric. One minutes object at a time, never two side by side, and the
 * judge is never told which host or model wrote it. No `temperature`: this
 * model refuses the field as deprecated, so a grade varies a little between
 * runs and the repeats absorb it.
 *
 * Its first four fields are the 2026-10-29 judge's; `speakerAttribution` is the
 * one this harness adds, because the prompt now has to keep N speakers apart.
 * Hashed into every summary, so two runs graded by different rubrics cannot be
 * compared by accident.
 */
const JUDGE_SYSTEM =
  'You grade meeting minutes written from a conversation. You get an accurate reference ' +
  'transcript (the minutes writer may have seen a noisier machine transcript of the same ' +
  'speech) and a minutes JSON object. Grade strictly and consistently. Return ONLY a JSON ' +
  'object: {"faithfulness":1-10,"coverage":1-10,"language":1-10,"usefulness":1-10,' +
  '"speakerAttribution":1-10,"hallucinations":integer,"notes":string}. faithfulness: every ' +
  'claim is supported by the transcript. coverage: the important content is captured. ' +
  'language: every string is natural, correct text in the language named in <language>. ' +
  'usefulness: a participant would find these minutes accurate and helpful; decisions and ' +
  'action items only when actually stated. speakerAttribution: owners and who-said-what match ' +
  "the transcript's speaker labels; give 10 when the transcript has no names to attribute and " +
  'the minutes invent none. hallucinations: count of distinct claims, decisions, owners or ' +
  'dates not supported by the transcript. notes: one short sentence.';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function parseArgs(argv) {
  const args = { arm: null, model: null, repeats: 2, corpus: 'all', gapMs: null, out: null };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const raw = argv[i + 1];
    if (raw === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--arm') {
      if (!(raw in MINUTES_HOSTS))
        throw new Error(`--arm must be gemini or commandcode, not ${raw}`);
      args.arm = raw;
    } else if (flag === '--repeats' || flag === '--gap-ms') {
      const value = Number(raw);
      if (!Number.isInteger(value) || value < (flag === '--repeats' ? 1 : 0)) {
        throw new Error(`${flag} needs a whole number, got ${JSON.stringify(raw)}`);
      }
      if (flag === '--repeats') args.repeats = value;
      else args.gapMs = value;
    } else if (flag === '--model') {
      args.model = raw;
    } else if (flag === '--corpus') {
      if (!['all', 'synthetic'].includes(raw)) throw new Error('--corpus must be all or synthetic');
      args.corpus = raw;
    } else if (flag === '--out') args.out = resolve(raw);
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!args.arm) throw new Error('--arm is required (gemini or commandcode)');
  // A free Gemini key allows ~14 requests a minute per model; Command Code does not need pacing.
  // Pinned, never the provider's fallback ladder: a paired comparison has to
  // hold the drafting model fixed, and the ladder moves to flash-lite whenever
  // the free tier cools flash down — once mixing models in 11 of 18 pairs and
  // failing the gate on a prompt that had not changed what flash writes.
  args.model ??= args.arm === 'gemini' ? 'gemini-3.5-flash' : MINUTES_HOSTS.commandcode.model;
  // ~7.5 requests a minute on a free Gemini key, half its per-model ceiling.
  args.gapMs ??= args.arm === 'gemini' ? 8000 : 0;
  args.out ??= resolve(HERE, 'results', `${stamp(new Date())}-${args.arm}`);
  return args;
}

/** YYMMDD-HHMM in local time, the repo's naming for dated runs. */
function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** The items to summarize, and a fingerprint of the real corpus (null when absent). */
function loadInputs(corpus) {
  const inputs = [];
  let realSha256 = null;
  if (corpus === 'all') {
    if (existsSync(REAL_CORPUS)) {
      const raw = readFileSync(REAL_CORPUS, 'utf8');
      realSha256 = sha256(raw);
      for (const c of JSON.parse(raw)) {
        inputs.push({
          id: `real-${c.id.slice(0, 8)}`,
          kind: 'real',
          // The stored turns carry no names, which is how a two-person
          // conversation reaches the summarizer when nobody attributed it.
          transcript: c.turns.map((t) => `Speaker: ${t}`).join('\n'),
          reference: c.reference,
          language: 'vi',
        });
      }
    } else {
      console.log('real corpus missing; synthetic only');
    }
  }
  for (const c of SYNTHETIC) {
    const transcript = c.turns.join('\n');
    inputs.push({
      id: c.id,
      kind: 'synthetic',
      transcript,
      reference: transcript,
      language: c.language,
    });
  }
  return { inputs, realSha256 };
}

/**
 * Waits before a generation is retried. The model is pinned, so a free Gemini
 * key that cools it down cannot fall back to flash-lite; one pinned run lost 10
 * of 18 drafts that way at 8 s spacing. Waiting the minute out keeps the row
 * on the same model instead of dropping its pair.
 */
const GENERATION_RETRY_MS = [65_000, 65_000, 65_000];

/** The draft, and how long the attempt that produced it took (waits excluded). */
async function summarizeWithPatience(provider, request) {
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now();
    try {
      const draft = await provider.summarize(request);
      return { draft, ms: Date.now() - t0 };
    } catch (err) {
      if (attempt >= GENERATION_RETRY_MS.length) throw err;
      console.log(
        `  retrying in ${GENERATION_RETRY_MS[attempt] / 1000}s: ${String(err?.message ?? err).slice(0, 80)}`,
      );
      await sleep(GENERATION_RETRY_MS[attempt]);
    }
  }
}

/**
 * Waits before each judge retry. Command Code intermittently answers 403
 * "the provider refused this request" for a request that passes a moment later
 * (seen on 8 of 18 grades in one run, every one a draft that generated fine),
 * and a judge refusal is not the arm's fault.
 */
const JUDGE_RETRY_MS = [3_000, 10_000, 30_000];

/** One blind grade, retried with backoff. */
async function judge(apiKey, input, draft) {
  const { model: _model, ...minutes } = draft;
  const content =
    `<language>${input.language}</language>\n` +
    `<reference_transcript>\n${input.reference}\n</reference_transcript>\n` +
    `<minutes>\n${JSON.stringify(minutes, null, 1)}\n</minutes>`;
  let lastError;
  for (let attempt = 0; attempt <= JUDGE_RETRY_MS.length; attempt++) {
    if (attempt > 0) await sleep(JUDGE_RETRY_MS[attempt - 1]);
    try {
      const response = await fetch(JUDGE_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: JUDGE_MODEL,
          max_tokens: 700,
          system: JUDGE_SYSTEM,
          messages: [{ role: 'user', content }],
        }),
        signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(`judge answered ${response.status}: ${JSON.stringify(body).slice(0, 200)}`);
      const text = body.content
        .map((part) => part.text ?? '')
        .join('')
        .trim();
      const grade = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      for (const key of [...SCORES, 'hallucinations']) {
        if (typeof grade[key] !== 'number') throw new Error(`judge omitted ${key}`);
      }
      return grade;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

const mean = (values) =>
  values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3)) : null;

function means(rows) {
  const judged = rows.filter((r) => !r.error);
  const out = { n: judged.length };
  for (const key of [...SCORES, 'hallucinations', 'ms']) out[key] = mean(judged.map((r) => r[key]));
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (existsSync(args.out)) {
    console.error(`refusing to overwrite ${args.out}`);
    process.exit(1);
  }
  const { inputs, realSha256 } = loadInputs(args.corpus);
  const provider = makeMinutesProvider({ host: args.arm, models: [args.model] });
  const judgeKey = readApiKey('COMMAND_CODE_API_KEY');
  mkdirSync(args.out, { recursive: true });

  const rowsPath = resolve(args.out, 'rows.jsonl');
  writeFileSync(rowsPath, '');
  const scored = [];
  const models = new Set();
  let calls = 0;

  for (let repeat = 1; repeat <= args.repeats; repeat++) {
    for (const input of inputs) {
      if (calls++ > 0 && args.gapMs) await sleep(args.gapMs);
      const t0 = Date.now();
      const row = { id: input.id, kind: input.kind, repeat, ms: 0, error: null };
      try {
        const { draft, ms } = await summarizeWithPatience(provider, {
          transcript: input.transcript,
          language: input.language,
        });
        row.ms = ms;
        models.add(draft.model);
        row.draft = draft;
        row.grade = await judge(judgeKey, input, draft);
      } catch (err) {
        row.ms ||= Date.now() - t0;
        row.error = String(err?.message ?? err).slice(0, 200);
      }
      writeFileSync(rowsPath, `${JSON.stringify(row)}\n`, { flag: 'a' });
      const numbers = {
        id: row.id,
        kind: row.kind,
        repeat,
        model: row.draft?.model ?? null,
        ms: row.ms,
        error: row.error !== null,
      };
      for (const key of [...SCORES, 'hallucinations']) numbers[key] = row.grade?.[key] ?? null;
      scored.push(numbers);
      console.log(`${row.id} r${repeat} ${row.ms}ms ${row.error ? `error ${row.error}` : 'ok'}`);
    }
  }

  const summary = {
    arm: args.arm,
    models: [...models].sort(),
    repeats: args.repeats,
    createdAt: new Date().toISOString(),
    promptSha256: sha256(buildMinutesInstruction('vi') + buildMinutesReminder()),
    judgeModel: JUDGE_MODEL,
    judgeSystemSha256: sha256(JUDGE_SYSTEM),
    corpus: {
      realSha256,
      realCount: inputs.filter((i) => i.kind === 'real').length,
      syntheticCount: inputs.filter((i) => i.kind === 'synthetic').length,
    },
    rows: scored,
    means: {
      real: means(scored.filter((r) => r.kind === 'real')),
      synthetic: means(scored.filter((r) => r.kind === 'synthetic')),
      all: means(scored),
    },
  };
  writeFileSync(resolve(args.out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`means ${JSON.stringify(summary.means.all)}`);
  console.log(`wrote ${args.out}`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
