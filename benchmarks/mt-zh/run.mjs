// Translate the fixed FLoRes set in six directions with the production provider.
//
//   DEEPSEEK_API_KEY=... node benchmarks/mt-zh/run.mjs --tag 261013-deepseek
//   DEEPSEEK_API_KEY=... node benchmarks/mt-zh/run.mjs --tag smoke-1 --limit 2 --repeats 1
//
// Spends real money; run by hand, never from CI.
//
// What is measured is the SHIPPED provider: `translation-providers.mjs` builds
// `OpenAiCompatibleTranslationProvider` from `packages/ai-providers/dist` with the
// `deepseek` preset (host, model, thinking-disabled flag, request gap), and the
// shipped prompt builder writes every byte of the instruction.
//
// The one thing production cannot do yet is NAME Chinese. The prompt builder
// reads `LANGUAGES[code].englishName` from `@chatofy/types`, which has only `vi`
// and `en`, so a `zh` request throws a TypeError before any traffic. Rather than
// re-typing the instruction here (a copy that would keep passing after the real
// one drifted), this harness adds ONE entry to the registry object at runtime —
// the same module instance the provider imports — and asserts from the captured
// request that it took. Everything else in the request is production's.
//
// Results go to results/<tag>/ and an existing tag is refused, never overwritten.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { makeTranslationProvider } from '../translation-providers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

/**
 * The name the prompt will use for zh. Not decided by the product yet; the
 * script check in `score.py` (Traditional characters in zh output) is what tells
 * whether this wording is enough to get Simplified script.
 */
const ZH_SPEC = { englishName: 'Simplified Chinese', nativeName: '简体中文' };

const DIRECTIONS = ['vi_to_zh', 'zh_to_vi', 'en_to_zh', 'zh_to_en', 'vi_to_en', 'en_to_vi'];

function parseArgs(argv) {
  const args = { tag: null, repeats: 3, limit: null, directions: DIRECTIONS };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const raw = argv[i + 1];
    if (raw === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--tag') {
      if (!/^[\w.-]+$/.test(raw))
        throw new Error(`--tag must be [A-Za-z0-9_.-]+, got ${JSON.stringify(raw)}`);
      args.tag = raw;
    } else if (flag === '--repeats' || flag === '--limit') {
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} needs an integer >= 1`);
      args[flag.slice(2)] = value;
    } else if (flag === '--directions') {
      const list = raw.split(',');
      const bad = list.filter((d) => !DIRECTIONS.includes(d));
      if (bad.length) throw new Error(`unknown direction(s): ${bad.join(', ')}`);
      args.directions = list;
    } else throw new Error(`unknown argument: ${flag}`);
  }
  if (!args.tag)
    throw new Error('usage: run.mjs --tag <tag> [--repeats 3] [--limit n] [--directions a,b]');
  return args;
}

/** The `@chatofy/types` module instance `packages/ai-providers` resolves to. */
async function providerTypesModule() {
  const pkgDir = realpathSync(
    join(REPO, 'packages', 'ai-providers', 'node_modules', '@chatofy', 'types'),
  );
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const entry = pkg.exports?.['.']?.import?.default;
  if (!entry) throw new Error('@chatofy/types has no ESM entry');
  return import(pathToFileURL(realpathSync(join(pkgDir, entry))).href);
}

function readSentences() {
  const path = join(HERE, 'data', 'sentences.jsonl');
  const rows = readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  for (const row of rows) {
    if (!row.zh || !row.vi || !row.en || !Number.isInteger(row.id))
      throw new Error(`bad row in ${path}: ${row.id}`);
  }
  return rows;
}

function gitHead() {
  try {
    return execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/**
 * Observe what the provider sends and what usage the host reports, without
 * touching the provider. The request BODY is captured (it holds no secret; the
 * key travels in a header, which is never read here). The response is cloned
 * so the provider's own stream is consumed exactly as in production.
 */
function installFetchTap() {
  const realFetch = globalThis.fetch;
  const tap = { lastBody: null, lastUsage: null };
  globalThis.fetch = async (url, init) => {
    tap.lastBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    tap.lastUsage = null;
    const response = await realFetch(url, init);
    if (response.ok && response.body) {
      const copy = response.clone();
      tap.lastUsage = copy
        .text()
        .then((text) => {
          let usage = null;
          for (const line of text.split('\n')) {
            if (!line.startsWith('data:') || !line.includes('"usage"')) continue;
            try {
              usage = JSON.parse(line.slice(5).trim()).usage ?? usage;
            } catch {
              /* keep the last parseable usage */
            }
          }
          return usage;
        })
        .catch(() => null);
    }
    return response;
  };
  return tap;
}

const args = parseArgs(process.argv.slice(2));
const outDir = join(HERE, 'results', args.tag);
if (existsSync(outDir))
  throw new Error(`${outDir} exists; results are never overwritten. Pick a new --tag.`);

const types = await providerTypesModule();
if (types.LANGUAGES.zh) throw new Error('registry already has zh; this shim is obsolete, drop it');
if (Object.isFrozen(types.LANGUAGES))
  throw new Error('LANGUAGES is frozen; cannot add zh at runtime');
types.LANGUAGES.zh = ZH_SPEC;

const tap = installFetchTap();
const { provider, models, gapMs, label } = makeTranslationProvider({ preset: 'deepseek' });
const [model] = models;
const sentences = args.limit ? readSentences().slice(0, args.limit) : readSentences();

mkdirSync(outDir, { recursive: true });
const meta = {
  tag: args.tag,
  startedAt: new Date().toISOString(),
  gitHead: gitHead(),
  node: process.version,
  preset: label,
  model,
  gapMs,
  repeats: args.repeats,
  sentences: sentences.length,
  directions: args.directions,
  registryShim: { zh: ZH_SPEC },
  order:
    'for repeat, for sentence, for direction — directions interleaved so time-of-day affects all equally',
  prompts: {},
};
const writeMeta = () =>
  writeFileSync(join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
writeMeta();

console.error(
  `${label} · ${model} · ${sentences.length} sentences × ${args.directions.length} directions × ` +
    `${args.repeats} repeats · ${gapMs}ms apart → ${outDir}`,
);

let failures = 0;
let done = 0;
const total = sentences.length * args.directions.length * args.repeats;
for (let repeat = 1; repeat <= args.repeats; repeat += 1) {
  for (const sentence of sentences) {
    for (const direction of args.directions) {
      const [source, target] = direction.split('_to_');
      let hypothesis = '';
      let error = null;
      let ttftMs;
      const started = Date.now();
      try {
        const result = await provider.translate({
          text: sentence[source],
          sourceLanguage: source,
          targetLanguage: target,
          onChunk: () => {
            ttftMs ??= Date.now() - started;
          },
        });
        hypothesis = result.text ?? '';
      } catch (err) {
        error = String(err?.message ?? err);
        failures += 1;
        if (err?.status === 401) {
          console.error('401 from host: key rejected. Stopping.');
          process.exit(3);
        }
        console.error(`  r${repeat} ${direction} ${sentence.id} failed: ${error}`);
      }
      const totalMs = Date.now() - started;
      const usage = tap.lastUsage ? await tap.lastUsage : null;

      if (!meta.prompts[direction] && tap.lastBody) {
        const [system, user] = tap.lastBody.messages ?? [];
        // Proof the shim reached the provider's prompt rather than a copy.
        const name = (code) =>
          code === 'zh' ? ZH_SPEC.englishName : types.LANGUAGES[code].englishName;
        if (!system?.content?.includes(`render what they said in ${name(target)}`)) {
          throw new Error(`captured system prompt for ${direction} does not name ${name(target)}`);
        }
        const { messages, ...rest } = tap.lastBody;
        meta.prompts[direction] = { body: rest, system: system.content, user: user?.content };
        writeMeta();
      }

      appendFileSync(
        join(outDir, `${direction}.jsonl`),
        `${JSON.stringify({
          id: sentence.id,
          direction,
          repeat,
          source: sentence[source],
          reference: sentence[target],
          hypothesis,
          error,
          model,
          ttftMs: ttftMs ?? null,
          totalMs,
          usage,
        })}\n`,
      );
      done += 1;
      if (done % 60 === 0) console.error(`  ${done}/${total} · failures ${failures}`);
      if (done < total) await sleep(gapMs);
    }
  }
}

meta.finishedAt = new Date().toISOString();
meta.failures = failures;
writeMeta();
console.error(`done · ${done} requests · ${failures} failures`);
