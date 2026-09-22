// Translate a corpus with the shipped provider, once per arm.
//
//   node benchmarks/error-analysis/translate-rows.mjs rows.jsonl > before.jsonl
//   node benchmarks/error-analysis/translate-rows.mjs rows.jsonl --glossary glossary.json > after.jsonl
//   node benchmarks/error-analysis/translate-rows.mjs rows.jsonl --provider deepseek > ds.jsonl
//
// Run manually. This spends real quota — on the free Gemini tier, 15 requests
// per minute per model — so it paces itself and is never wired into `pnpm test`
// or CI. The pacing belongs to the host and comes from the preset, so a host
// that meters spend rather than requests is not slowed to a free tier's speed.
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
//
// Every row also carries `ttftMs`, `totalMs` and `chars`. They are written here
// rather than in a harness of their own because the request has already been
// paid for: the question "how much of a translation arrives after its first
// token" needs no traffic beyond what an arm was going to send anyway, and
// `streaming-headroom.mjs` reads these files without translating.
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { makeTranslationProvider, takeProviderArgs } from '../translation-providers.mjs';

/**
 * One model per run, so the comparison is not confounded by a provider's ladder.
 *
 * WHICH model is the preset's to say, and `translation-providers.mjs` records
 * why each default is the one it is. What matters here is that a run pins
 * exactly one: it was once the other way round, and the cost was a recorded
 * result nobody could attribute — the arms in `results/` were produced on 3.5
 * while the default and the README's commands both said 3.1, so the numbers
 * could not be reproduced from the instructions beside them.
 */

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
      'usage: translate-rows.mjs <rows.jsonl> [--glossary f] [--model m] [--gap-ms n] ' +
        '[--provider gemini|deepseek|openai-compatible] [--base-url u] [--api-key-env v] ' +
        '[--extra-body json]',
    );
  }
  // Left undefined rather than defaulted: the preset supplies both, and a value
  // set here would silently outrank it.
  const args = { rowsPath, glossary: null, model: undefined, gapMs: undefined };

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

const { provider: providerArgs, rest: ownArgs } = takeProviderArgs(process.argv.slice(2));
const args = parseArgs(ownArgs);
const rows = readRows(args.rowsPath);
const glossary = readGlossary(args.glossary);
const { provider, models, gapMs } = makeTranslationProvider({
  ...providerArgs,
  models: args.model ? [args.model] : undefined,
  gapMs: args.gapMs,
});
const [model] = models;

// Progress goes to STDERR. Stdout carries the rows and nothing else — the
// redirect belongs to the caller, as it does for `analyze.mjs`, because a scorer
// that writes into recorded results is how a smoke run silently corrupts a real
// one.
console.error(
  `translating ${rows.length} rows · ${model} · ` +
    `${glossary ? `${glossary.length} glossary pairs` : 'no glossary'} · ${gapMs}ms apart`,
);

for (const [index, row] of rows.entries()) {
  const { source, target } = LANGUAGES[row.direction];
  let hypothesis = '';
  // What arrives before the first piece, and what arrives after it. The gap
  // between them is the ONLY thing streaming a translation onward can save, so
  // recording both is what turns "should we stream into speech" from a matter
  // of taste into a number. Measured per row because the answer depends on
  // length: a four-word turn has almost no tail, and a long one might.
  let ttftMs;
  const started = Date.now();
  try {
    const result = await provider.translate({
      text: row.source,
      sourceLanguage: source,
      targetLanguage: target,
      // Timing only. The pieces themselves are discarded — the recorded
      // hypothesis stays the finished text, so every scorer reading these files
      // keeps reading exactly what it read before.
      onChunk: () => {
        ttftMs ??= Date.now() - started;
      },
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
  console.log(
    JSON.stringify({
      ...row,
      hypothesis,
      model,
      ttftMs,
      totalMs: Date.now() - started,
      // Of the finished text, since that is what a synthesizer would have had
      // to speak.
      chars: hypothesis.length,
    }),
  );

  if (index < rows.length - 1) await sleep(gapMs);
}

console.error('done');
