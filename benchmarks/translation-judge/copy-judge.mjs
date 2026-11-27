// Scores interface copy (the @chatofy/i18n dictionaries, plus any extra items
// such as email bodies) with a Claude judge, one locale batch at a time.
//
// Each string is scored 1–5 on four axes: naturalness (reads as if written in
// that language), fidelity (same meaning and product claims as the reference),
// register (the voice rules in docs/copy-voice-and-terminology.md) and
// terminology (the term table in that doc). A string's score is its lowest axis.
//
// The reference for meaning is the English on the BASE ref: a rewrite must not
// drift from what the product promised before. For en itself, the new English
// is compared against the old; for vi and zh, the locale text is compared
// against the new English and the old English together.
//
// Usage (from the repo root, Node ≥ 23 for native TypeScript imports):
//   node benchmarks/translation-judge/copy-judge.mjs --base main --out <dir> \
//     [--locales en,vi,zh] [--only key1,key2] [--items extra.json] [--cap-usd 10]
//
// Extra items: a JSON array of { id, locale, oldEn, newEn, text } — used for
// strings that live outside the dictionaries (emails).
//
// The spend cap is checked on a live counter before every batch of the run, and
// the counter is seeded from the cost already recorded in <dir>. A batch is
// skipped when the spend so far plus the previous batch's cost would pass the
// cap, so a run stops a batch early rather than a batch late. The previous cost
// is the last one in <dir>'s ledger, so only the very first batch into an empty
// <dir> runs without an estimate.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

import { costOf } from './judge-providers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const MODEL = 'claude-opus-5-5';
const BATCH = 50;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

/** The key lives in the environment or a repo-root .env; a worktree falls back to the main checkout's. */
function loadAnthropicKey() {
  if (process.env.ANTHROPIC_API_KEY) return;
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  const candidates = [join(ROOT, '.env'), join(resolve(ROOT, common), '..', '.env')];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const line = readFileSync(file, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('ANTHROPIC_API_KEY='));
    if (!line) continue;
    process.env.ANTHROPIC_API_KEY = line
      .slice('ANTHROPIC_API_KEY='.length)
      .trim()
      .replace(/^["']|["']$/g, '');
    return;
  }
  throw new Error('ANTHROPIC_API_KEY is not set in the environment or a repo-root .env');
}

/** Imports the three dictionaries as they were at `ref`, through a temp copy. */
async function dictionariesAt(ref, tmp, locales) {
  mkdirSync(tmp, { recursive: true });
  for (const locale of locales) {
    const source = execFileSync('git', ['show', `${ref}:packages/i18n/src/${locale}.ts`], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    writeFileSync(join(tmp, `${locale}.ts`), source);
  }
  return loadDictionaries(tmp, locales);
}

/** Only the locales a run needs, so a dictionary another writer has open is never imported half-saved. */
async function loadDictionaries(dir, locales) {
  const out = {};
  for (const locale of locales) {
    const mod = await import(`${pathToFileURL(join(dir, `${locale}.ts`)).href}?t=${Date.now()}`);
    out[locale] = mod[locale];
  }
  return out;
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'naturalness',
          'fidelity',
          'register',
          'terminology',
          'issue',
          'suggestion',
        ],
        properties: {
          id: { type: 'string' },
          naturalness: { type: 'integer' },
          fidelity: { type: 'integer' },
          register: { type: 'integer' },
          terminology: { type: 'integer' },
          issue: { type: 'string' },
          suggestion: { type: 'string' },
        },
      },
    },
  },
};

const LOCALE_NAME = { en: 'English', vi: 'Vietnamese', zh: 'Simplified Chinese' };

function systemPrompt(guide) {
  return `You are a senior native-speaker copy editor reviewing the interface copy of Chatofy, a real-time speech translation product (web app, mobile app, browser extension, emails). You judge each string as a native reader of its language would see it on screen.

Score every string 1–5 on four axes:
- naturalness: 5 = reads exactly as a native product writer would write it; 4 = natural, a picky editor might tweak one word; 3 = understandable but visibly translated or stiff; 2 = awkward; 1 = wrong or broken.
- fidelity: does it say the same thing as the reference English (meaning, product claims, numbers, conditions, placeholders like {name})? 5 = same meaning; 3 = a nuance lost or added; 1 = a claim changed or dropped. Rewording is fine; changing a promise is not.
- register: follows the voice rules below (concise, friendly, not corporate, not slangy; names the wait, outcome or next step, never the pipeline; address rules).
- terminology: uses the chosen term from the table below for every product concept; 5 if no product term appears.

Rules for scoring:
- Judge short labels as labels: a two-word button is not unnatural because it is short.
- Placeholders in {braces} must survive verbatim; a missing or renamed placeholder is fidelity 1.
- The two landing demo lines are a conversation between a Vietnamese and an English speaker; each keeps its own language in every locale. Do not penalise that.
- When any axis is below 4, "issue" names the problem in one short English sentence and "suggestion" gives a full replacement string in the target language. Otherwise both are "".
- Return one result per input id, same ids, nothing else.

Voice and terminology guide:
<guide>
${guide}
</guide>`;
}

function batchMessage(locale, items) {
  const lines = items.map((it) => {
    const parts = [`id: ${it.id}`, `reference English (before): ${JSON.stringify(it.oldEn)}`];
    if (locale !== 'en')
      parts.push(`reference English (after rewrite): ${JSON.stringify(it.newEn)}`);
    parts.push(`${LOCALE_NAME[locale]} string to judge: ${JSON.stringify(it.text)}`);
    return parts.join('\n');
  });
  return `Locale under review: ${LOCALE_NAME[locale]} (${locale}). ${items.length} strings.\n\n${lines.join('\n\n')}`;
}

async function main() {
  const base = arg('base', 'main');
  const out = resolve(arg('out', join(HERE, 'results', 'copy-judge')));
  const locales = arg('locales', 'en,vi,zh').split(',');
  const only = arg('only') ? new Set(arg('only').split(',')) : null;
  const cap = Number(arg('cap-usd', '10'));
  mkdirSync(out, { recursive: true });
  const ledger = join(out, 'judgements.jsonl');

  let spent = 0;
  // What the next batch is expected to cost: the last batch's actual cost.
  let lastCost = 0;
  if (existsSync(ledger)) {
    for (const line of readFileSync(ledger, 'utf8').split('\n').filter(Boolean)) {
      lastCost = JSON.parse(line).costUsd ?? 0;
      spent += lastCost;
    }
  }

  loadAnthropicKey();
  const needed = [...new Set(['en', ...locales])];
  const old = await dictionariesAt(base, join(out, `.base-${base.replace(/\W/g, '_')}`), ['en']);
  const now = await loadDictionaries(join(ROOT, 'packages', 'i18n', 'src'), needed);
  const guidePath = join(ROOT, 'docs', 'copy-voice-and-terminology.md');
  const guide = existsSync(guidePath) ? readFileSync(guidePath, 'utf8') : '(no guide yet)';

  const items = [];
  for (const locale of locales) {
    for (const key of Object.keys(now.en)) {
      if (only && !only.has(key)) continue;
      items.push({
        id: key,
        locale,
        oldEn: old.en[key] ?? now.en[key],
        newEn: now.en[key],
        text: now[locale][key],
      });
    }
  }
  const extra = arg('items');
  if (extra) {
    for (const it of JSON.parse(readFileSync(resolve(extra), 'utf8'))) {
      if (locales.includes(it.locale) && (!only || only.has(it.id))) items.push(it);
    }
  }

  const client = new Anthropic({ maxRetries: 6 });
  const system = [
    { type: 'text', text: systemPrompt(guide), cache_control: { type: 'ephemeral' } },
  ];
  const scores = [];

  for (const locale of locales) {
    const mine = items.filter((it) => it.locale === locale);
    for (let i = 0; i < mine.length; i += BATCH) {
      if (spent + lastCost > cap) {
        console.error(
          `stopped: spend $${spent.toFixed(2)} plus the last batch's $${lastCost.toFixed(2)} would pass the $${cap} cap`,
        );
        process.exitCode = 2;
        return finish(out, scores, spent);
      }
      const batch = mine.slice(i, i + BATCH);
      // Streamed: a 50-string batch with thinking can outlast the SDK's non-streaming limit.
      const response = await client.messages
        .stream({
          model: MODEL,
          max_tokens: 32000,
          system,
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
          messages: [{ role: 'user', content: batchMessage(locale, batch) }],
        })
        .finalMessage();
      if (response.stop_reason === 'refusal') throw new Error('judge refused a batch');
      if (response.stop_reason === 'max_tokens') throw new Error('judge hit max_tokens');
      const cost = costOf(MODEL, response.usage);
      spent += cost;
      lastCost = cost;
      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const byId = new Map(JSON.parse(text).results.map((r) => [r.id, r]));
      for (const it of batch) {
        const r = byId.get(it.id);
        if (!r) throw new Error(`judge skipped ${locale}:${it.id}`);
        const row = {
          ...it,
          ...r,
          score: Math.min(r.naturalness, r.fidelity, r.register, r.terminology),
        };
        scores.push(row);
      }
      appendFileSync(
        ledger,
        `${JSON.stringify({ locale, from: i, n: batch.length, costUsd: cost, at: new Date().toISOString() })}\n`,
      );
      console.error(`${locale} ${i + batch.length}/${mine.length}  spent $${spent.toFixed(2)}`);
    }
  }
  return finish(out, scores, spent);
}

function finish(out, scores, spent) {
  writeFileSync(join(out, 'scores.json'), JSON.stringify(scores, null, 2));
  const summary = {};
  for (const s of scores) {
    const loc = (summary[s.locale] ??= {
      n: 0,
      below4: 0,
      mean: 0,
      hist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
    loc.n += 1;
    loc.mean += s.score;
    loc.hist[s.score] += 1;
    if (s.score < 4) loc.below4 += 1;
  }
  for (const loc of Object.values(summary)) loc.mean = Number((loc.mean / loc.n).toFixed(2));
  writeFileSync(
    join(out, 'summary.json'),
    JSON.stringify({ spentUsd: Number(spent.toFixed(2)), summary }, null, 2),
  );
  console.log(JSON.stringify({ spentUsd: Number(spent.toFixed(2)), summary }));
}

await main();
