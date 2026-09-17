// Translate a corpus with the shipped provider, once per arm.
//
//   node benchmarks/error-analysis/translate-rows.mjs rows.jsonl > before.jsonl
//   node benchmarks/error-analysis/translate-rows.mjs rows.jsonl --glossary glossary.json > after.jsonl
//
// Run manually. This spends real Gemini quota against the free tier's 15
// requests/minute per model, so it paces itself and is never wired into
// `pnpm test` or CI.
//
// It drives `GeminiTranslationProvider` itself rather than re-declaring the
// prompt, for the reason `benchmarks/prompt-injection/run.mjs` gives: a harness
// carrying its own copy of the instruction keeps passing after the real one has
// drifted, and would have nothing to say about production. That is also why the
// glossary is handed over as `hints` rather than pasted into the source — what is
// being measured is the SHIPPED context block, not a mock of it.
//
// `analyze.mjs` never translates; it only classifies rows that already carry a
// `hypothesis`. This is what produces one.
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { GeminiTranslationProvider } from '../../packages/ai-providers/dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

/** One model, so the comparison is not confounded by the provider's ladder. */
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';

/** ~14/min, just under the free tier's per-model ceiling. */
const DEFAULT_GAP_MS = 4300;

const LANGUAGES = {
  vi_to_en: { source: 'vi', target: 'en' },
  en_to_vi: { source: 'en', target: 'vi' },
};

/**
 * Arguments, validated rather than coerced.
 *
 * `Number('2x')` is NaN and every comparison against it is false, so a typo would
 * run zero rows and then report a clean sweep. Every bad input stops the run.
 */
function parseArgs(argv) {
  const [rowsPath, ...rest] = argv;
  if (!rowsPath) {
    throw new Error(
      'usage: translate-rows.mjs <rows.jsonl> [--glossary f] [--model m] [--gap-ms n]',
    );
  }
  const args = { rowsPath, glossary: null, model: DEFAULT_MODEL, gapMs: DEFAULT_GAP_MS };

  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const raw = rest[i + 1];
    if (raw === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--glossary') args.glossary = raw;
    else if (flag === '--model') args.model = raw;
    else if (flag === '--gap-ms') {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 1) {
        throw new Error(`--gap-ms needs a number >= 1, got ${JSON.stringify(raw)}`);
      }
      args.gapMs = value;
    } else throw new Error(`unknown argument: ${flag}`);
  }
  return args;
}

/** The API key the api itself uses; never printed. */
function readApiKey() {
  const fromEnv = process.env.GEMINI_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  const envPath = resolve(REPO, 'apps/api/.env');
  let file = '';
  try {
    file = readFileSync(envPath, 'utf8');
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
    throw new Error(`set GEMINI_API_KEY, or put it in ${envPath}`);
  }
  const key = /^GEMINI_API_KEY=(.*)$/m.exec(file)?.[1]?.trim();
  if (!key) throw new Error(`GEMINI_API_KEY not found in ${envPath}`);
  return key;
}

function readRows(path) {
  const rows = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`${path}:${index + 1} is not valid JSON: ${err.message}`);
      }
    });

  // REFUSED at the second zero rather than after eighty paid requests. Both
  // checks are the same rule `analyze.mjs` applies to `reference`: a result
  // computed over whichever rows happened to be complete is a number nobody
  // chose — and here it would also have been paid for.
  const noDirection = rows.filter((row) => !LANGUAGES[row.direction]);
  if (noDirection.length) {
    throw new Error(
      `${noDirection.length} of ${rows.length} rows have no usable \`direction\`. ` +
        'It is REQUIRED and explicit: detecting a language from a short utterance is ' +
        'exactly the guess this corpus exists to avoid.',
    );
  }
  const noReference = rows.filter((row) => !row.reference);
  if (noReference.length) {
    throw new Error(
      `${noReference.length} of ${rows.length} rows have no \`reference\`. Nothing would be scorable.`,
    );
  }
  return rows;
}

function readGlossary(path) {
  if (!path) return undefined;
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const glossary = Array.isArray(parsed) ? parsed : parsed.glossary;
  if (!Array.isArray(glossary) || !glossary.length) {
    throw new Error(`${path} carries no glossary entries`);
  }
  for (const entry of glossary) {
    if (!entry?.vi || !entry?.en) {
      throw new Error(`${path}: every entry needs both a vi and an en side`);
    }
  }
  return glossary.map((entry) => ({ vi: entry.vi, en: entry.en }));
}

const args = parseArgs(process.argv.slice(2));
const rows = readRows(args.rowsPath);
const glossary = readGlossary(args.glossary);
const provider = new GeminiTranslationProvider({
  apiKey: readApiKey(),
  models: [args.model],
});

// Progress goes to STDERR. Stdout carries the rows and nothing else — the
// redirect belongs to the caller, as it does for `analyze.mjs`, because a scorer
// that writes into recorded results is how a smoke run silently corrupts a real
// one.
console.error(
  `translating ${rows.length} rows · ${args.model} · ` +
    `${glossary ? `${glossary.length} glossary pairs` : 'no glossary'}`,
);

for (const [index, row] of rows.entries()) {
  const { source, target } = LANGUAGES[row.direction];
  let hypothesis = '';
  try {
    const result = await provider.translate({
      text: row.source,
      sourceLanguage: source,
      targetLanguage: target,
      // The glossary rides as HINTS, exactly as a selected AI Context does in
      // production. Entries are keyed by language and are NOT re-keyed per
      // direction here: the prompt builder resolves the source side against the
      // direction it is given, which is the whole point of the keying.
      ...(glossary ? { hints: { glossary } } : {}),
    });
    hypothesis = result.text ?? '';
  } catch (err) {
    // Recorded rather than dropped: a row that never completed must not silently
    // become a row that translated perfectly.
    console.error(`  ${row.id} failed: ${String(err)}`);
  }
  // The model goes in the ROW, not only in the stderr banner above. A recorded
  // arm outlives the shell that produced it: the banner scrolls away, the file
  // is committed, and a later reader has nothing in it that says which model
  // answered. Two arms compared across different models is the one way this
  // benchmark can lie, and a field per row is what makes that checkable instead
  // of inferred from whichever prose was written afterwards.
  console.log(JSON.stringify({ ...row, hypothesis, model: args.model }));

  if (index < rows.length - 1) await sleep(args.gapMs);
}

console.error('done');
