// Translate the fixed FLoRes set in six directions with the production provider.
//
//   DEEPSEEK_API_KEY=... node benchmarks/mt-zh/run.mjs --tag 261013-deepseek
//   DEEPSEEK_API_KEY=... node benchmarks/mt-zh/run.mjs --tag smoke-1 --limit 2 --repeats 1
//   node benchmarks/mt-zh/run.mjs --tag <tag> --provider openai-compatible \
//     --base-url <url> --api-key-env <VAR> --model <id> [--gap-ms n] [--extra-body json]
//
// Spends real money; run by hand, never from CI.
//
// What is measured is the SHIPPED provider: `translation-providers.mjs` builds
// `OpenAiCompatibleTranslationProvider` from `packages/ai-providers/dist` with the
// `deepseek` preset (host, model, thinking-disabled flag, request gap), and the
// shipped prompt builder writes every byte of the instruction.
//
// The registry names Chinese now (`LANGUAGES.zh`), so the run checks from the
// captured request that the prompt names the registry's language rather than
// patching it in; the 2026-10-13 r3 run predates that and carried a runtime
// shim, recorded as `registryShim` in its meta.json.
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
import { makeTranslationProvider, takeProviderArgs } from '../translation-providers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

const DIRECTIONS = ['vi_to_zh', 'zh_to_vi', 'en_to_zh', 'zh_to_en', 'vi_to_en', 'en_to_vi'];

function parseArgs(argv) {
  const args = {
    tag: null,
    repeats: 3,
    limit: null,
    directions: DIRECTIONS,
    model: undefined,
    gapMs: undefined,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const raw = argv[i + 1];
    if (raw === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--tag') {
      if (!/^[\w.-]+$/.test(raw))
        throw new Error(`--tag must be [A-Za-z0-9_.-]+, got ${JSON.stringify(raw)}`);
      args.tag = raw;
    } else if (flag === '--model') {
      args.model = raw;
    } else if (flag === '--gap-ms') {
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0) throw new Error(`--gap-ms needs an integer >= 0`);
      args.gapMs = value;
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
    throw new Error(
      'usage: run.mjs --tag <tag> [--repeats 3] [--limit n] [--directions a,b] ' +
        '[--model m] [--gap-ms n] [--provider p --base-url u --api-key-env V --extra-body json]',
    );
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

// The provider flags are the shared ones `translation-providers.mjs` parses; with
// none given the run measures the shipped `deepseek` preset exactly as before.
const { provider: providerArgs, rest: ownArgs } = takeProviderArgs(process.argv.slice(2));
const args = parseArgs(ownArgs);
const outDir = join(HERE, 'results', args.tag);
if (existsSync(outDir))
  throw new Error(`${outDir} exists; results are never overwritten. Pick a new --tag.`);

const types = await providerTypesModule();
if (!types.LANGUAGES.zh) throw new Error('the registry has no zh; rebuild packages/types');

const tap = installFetchTap();
const { provider, models, gapMs, label } = makeTranslationProvider({
  preset: 'deepseek',
  ...providerArgs,
  models: args.model ? [args.model] : undefined,
  gapMs: args.gapMs,
});
const [model] = models;
const sentences = args.limit ? readSentences().slice(0, args.limit) : readSentences();

mkdirSync(outDir, { recursive: true });
const meta = {
  tag: args.tag,
  startedAt: new Date().toISOString(),
  gitHead: gitHead(),
  node: process.version,
  preset: label,
  baseUrl: providerArgs.baseUrl ?? null,
  extraBody: providerArgs.extraBody ?? null,
  model,
  gapMs,
  repeats: args.repeats,
  sentences: sentences.length,
  directions: args.directions,
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
        // Proof the registry's name reached the provider's prompt rather than a copy.
        const name = (code) => types.LANGUAGES[code].englishName;
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
